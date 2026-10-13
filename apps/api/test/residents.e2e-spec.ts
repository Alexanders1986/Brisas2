import type { INestApplication } from '@nestjs/common';
import {
  API,
  type Scenario,
  acceptInvitation,
  bearer,
  createScenario,
  createTestApp,
  createTowerWithUnits,
  http,
  login,
  residentPayload,
  uniqueSuffix,
} from './helpers';

describe('Residentes y unidades', () => {
  let app: INestApplication;
  let scenario: Scenario;
  let towerId: string;
  let units: Map<string, string>;

  const base = () => `${API}/tenants/${scenario.tenantA.tenantId}`;
  const admin = () => bearer(scenario.tenantA.adminToken);
  const create = (payload: Record<string, unknown>) => http(app).post(`${base()}/residents`).set(...admin()).send(payload);

  beforeAll(async () => {
    app = await createTestApp();
    scenario = await createScenario(app);
    ({ towerId, units } = await createTowerWithUnits(app, scenario.tenantA));
  });

  afterAll(async () => {
    await scenario.pool.end();
    await app.close();
  });

  describe('torres y unidades', () => {
    it('genera las unidades numeradas por piso y no las duplica al repetir', async () => {
      expect([...units.keys()].sort()).toEqual(['101', '102', '201', '202']);
      const again = await http(app)
        .post(`${base()}/properties/generate`)
        .set(...admin())
        .send({ towerId, fromFloor: 1, toFloor: 3, unitsPerFloor: 2 })
        .expect(200);
      expect(again.body).toEqual({ created: 2, skipped: 4 });
    });

    it('rechaza torres y unidades duplicadas con un error por campo', async () => {
      const tower = await http(app).post(`${base()}/towers`).set(...admin()).send({ name: 'torre 1' }).expect(409);
      expect(tower.body.error).toMatchObject({ code: 'DUPLICATE_TOWER', fields: { name: expect.any(String) } });
      const unit = await http(app).post(`${base()}/properties`).set(...admin()).send({ towerId, number: '101' }).expect(409);
      expect(unit.body.error.code).toBe('DUPLICATE_PROPERTY');
    });

    it('no elimina una torre que tiene unidades', async () => {
      const response = await http(app).delete(`${base()}/towers/${towerId}`).set(...admin()).expect(409);
      expect(response.body.error.code).toBe('TOWER_HAS_UNITS');
    });
  });

  describe('asistente de registro', () => {
    it('guarda persona, vinculación, parqueaderos, depósitos y mascotas en una sola operación', async () => {
      const payload = residentPayload(units.get('101')!, {
        parkingSpaces: [{ number: 'P-01', kind: 'car' }, { number: 'M-07', kind: 'motorcycle' }],
        storageUnits: [{ number: 'D-01' }],
        pets: [{ species: 'dog', breed: 'Criollo', name: 'Luna' }],
        libertadTradicionAvailable: true,
      });
      const created = await create(payload).expect(201);
      expect(created.body).toMatchObject({ invitationSent: false });

      const detail = await http(app).get(`${base()}/residents/${created.body.personId}`).set(...admin()).expect(200);
      expect(detail.body).toMatchObject({
        firstName: 'Ana',
        email: payload.person.email,
        accessStatus: 'none',
        libertadTradicionAvailable: true,
        documentNumber: payload.person.documentNumber,
      });
      expect(detail.body.occupancies).toEqual([
        expect.objectContaining({ propertyLabel: 'Torre 1 · Apto 101', relationship: 'owner', householdSize: 3, endDate: null }),
      ]);
      expect(detail.body.parkingSpaces.map((item: { number: string }) => item.number)).toEqual(['M-07', 'P-01']);
      expect(detail.body.storageUnits).toHaveLength(1);
      expect(detail.body.pets).toEqual([expect.objectContaining({ species: 'dog', name: 'Luna' })]);
      expect(detail.body.changes[0]).toMatchObject({ action: 'resident.created', actorName: 'Admin alfa' });
    });

    it('valida los datos y señala cada campo con error', async () => {
      const response = await create({
        person: { firstName: '', lastName: 'Pérez', email: 'no-es-correo', phone: '300 555 0100' },
        relationship: 'dueño',
        propertyId: 'no-es-uuid',
        startDate: '2026-02-30',
        householdSize: 0,
      }).expect(400);
      expect(Object.keys(response.body.error.fields).sort()).toEqual(
        ['householdSize', 'person.email', 'person.firstName', 'propertyId', 'relationship', 'startDate'].sort(),
      );
    });

    it('impide registrar dos veces a la misma persona y ofrece la coincidencia', async () => {
      const payload = residentPayload(units.get('102')!);
      const first = await create(payload).expect(201);

      const sameEmail = await create({
        ...residentPayload(units.get('201')!),
        person: { firstName: 'Otra', lastName: 'Persona', email: payload.person.email.toUpperCase(), phone: '300 555 0100' },
      }).expect(409);
      expect(sameEmail.body.error.code).toBe('DUPLICATE_PERSON');
      expect(sameEmail.body.error.details.matches[0]).toMatchObject({ personId: first.body.personId, matchedBy: 'email' });

      const check = await http(app)
        .get(`${base()}/residents/duplicates`)
        .query({ documentNumber: payload.person.documentNumber })
        .set(...admin())
        .expect(200);
      expect(check.body.matches).toEqual([expect.objectContaining({ personId: first.body.personId, matchedBy: 'document' })]);

      // Vincular a la persona existente con otra unidad sí está permitido…
      await create({ ...residentPayload(units.get('201')!), person: undefined, existingPersonId: first.body.personId, relationship: 'tenant' }).expect(201);
      // …pero no dos veces a la misma unidad.
      const twice = await create({ ...residentPayload(units.get('201')!), person: undefined, existingPersonId: first.body.personId }).expect(409);
      expect(twice.body.error.code).toBe('OCCUPANCY_EXISTS');
    });

    it('no reasigna en silencio un parqueadero que ya pertenece a otra unidad', async () => {
      const response = await create(residentPayload(units.get('202')!, { parkingSpaces: [{ number: 'p-01' }] })).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'ASSET_ALREADY_ASSIGNED',
        fields: { 'parkingSpaces.0.number': 'Ya está asignado a Torre 1 · Apto 101' },
      });
      // La transacción se revirtió completa: no quedó la persona a medias.
      const list = await http(app).get(`${base()}/residents`).query({ propertyId: units.get('202') }).set(...admin()).expect(200);
      expect(list.body.total).toBe(0);
    });
  });

  describe('listado', () => {
    it('busca, filtra, ordena y pagina', async () => {
      const all = await http(app).get(`${base()}/residents`).query({ pageSize: 1, page: 2 }).set(...admin()).expect(200);
      expect(all.body).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
      expect(all.body.items).toHaveLength(1);

      const tenants = await http(app).get(`${base()}/residents`).query({ relationship: 'tenant' }).set(...admin()).expect(200);
      expect(tenants.body.total).toBe(1);

      const byTower = await http(app).get(`${base()}/residents`).query({ towerId }).set(...admin()).expect(200);
      expect(byTower.body.total).toBe(2);

      const none = await http(app).get(`${base()}/residents`).query({ search: '100%' }).set(...admin()).expect(200);
      expect(none.body.total).toBe(0);

      const invalid = await http(app).get(`${base()}/residents`).query({ pageSize: 5000 }).set(...admin()).expect(400);
      expect(invalid.body.error.fields.pageSize).toBeDefined();
    });
  });

  describe('edición, acceso e historial', () => {
    it('edita los datos y deja registro de qué cambió y quién lo hizo', async () => {
      const created = await create(residentPayload(units.get('202')!)).expect(201);
      const personId = created.body.personId as string;
      await http(app)
        .put(`${base()}/residents/${personId}`)
        .set(...admin())
        .send({ firstName: 'Ana María', lastName: 'Rincón', phone: '311 555 0199', gender: 'female', birthDate: '1988-05-17' })
        .expect(204);
      const detail = await http(app).get(`${base()}/residents/${personId}`).set(...admin()).expect(200);
      expect(detail.body).toMatchObject({
        firstName: 'Ana María',
        lastName: 'Rincón',
        email: null,
        documentNumber: null,
        gender: 'female',
        birthDate: '1988-05-17',
      });
      expect(detail.body.changes[0]).toMatchObject({ action: 'resident.updated' });
      expect(detail.body.changes[0].summary).toContain('nombres');
    });

    it('invita al residente, le da el rol según su vinculación y permite quitarle el acceso', async () => {
      const email = `residente-${uniqueSuffix()}@pruebas.test`;
      const tower = await createTowerWithUnits(app, scenario.tenantA, 'Torre 9');
      const created = await create(
        residentPayload(tower.units.get('101')!, {
          person: { firstName: 'Rosa', lastName: 'Niño', email, phone: '300 555 0100' },
          relationship: 'tenant',
          sendInvitation: true,
        }),
      ).expect(201);
      expect(created.body.invitationSent).toBe(true);
      const personId = created.body.personId as string;
      const statusOf = async () =>
        (await http(app).get(`${base()}/residents/${personId}`).set(...admin()).expect(200)).body.accessStatus;
      expect(await statusOf()).toBe('invited');

      // Antes de aceptar la invitación la cuenta no puede iniciar sesión.
      await http(app).post(`${API}/auth/login`).send({ email, password: 'Cualquier-Clave-1' }).expect(401);

      await acceptInvitation(app, email);
      expect(await statusOf()).toBe('active');
      const resident = await login(app, email);
      const me = await http(app).get(`${API}/auth/me`).set(...bearer(resident.accessToken)).expect(200);
      expect(me.body.memberships).toEqual([
        expect.objectContaining({ tenantId: scenario.tenantA.tenantId, roles: ['tenant_resident'] }),
      ]);
      const consent = await scenario.pool.query(
        `SELECT c.kind FROM consents c JOIN users u ON u.id = c.user_id WHERE u.email = $1`,
        [email],
      );
      expect(consent.rows).toEqual([{ kind: 'data_treatment' }]);

      // Desactivar el acceso corta la entrada al conjunto de inmediato, con el mismo token.
      await http(app).put(`${base()}/residents/${personId}/access`).set(...admin()).send({ enabled: false }).expect(200);
      expect(await statusOf()).toBe('disabled');
      await http(app).get(`${base()}/branding`).set(...bearer(resident.accessToken)).expect(404);

      const enabled = await http(app).put(`${base()}/residents/${personId}/access`).set(...admin()).send({ enabled: true }).expect(200);
      expect(enabled.body).toEqual({ accessStatus: 'active', invitationSent: false });
      await http(app).get(`${base()}/branding`).set(...bearer(resident.accessToken)).expect(200);
    });

    it('al terminar la vinculación conserva el historial y suspende el acceso', async () => {
      const email = `saliente-${uniqueSuffix()}@pruebas.test`;
      const tower = await createTowerWithUnits(app, scenario.tenantA, 'Torre 8');
      const created = await create(
        residentPayload(tower.units.get('101')!, { person: { firstName: 'Luis', lastName: 'Mora', email, phone: '300 555 0100' }, sendInvitation: true }),
      ).expect(201);
      const { personId, occupancyId } = created.body;
      await acceptInvitation(app, email);
      const end = (endDate: string) =>
        http(app).post(`${base()}/residents/${personId}/occupancies/${occupancyId}/end`).set(...admin()).send({ endDate });

      const early = await end('2025-12-31').expect(422);
      expect(early.body.error.code).toBe('INVALID_END_DATE');
      await end('2026-06-30').expect(204);
      await end('2026-07-01').expect(409);

      const detail = await http(app).get(`${base()}/residents/${personId}`).set(...admin()).expect(200);
      expect(detail.body.occupancies).toEqual([]);
      expect(detail.body.occupancyHistory).toEqual([expect.objectContaining({ id: occupancyId, endDate: '2026-06-30' })]);
      expect(detail.body.accessStatus).toBe('disabled');

      const active = await http(app).get(`${base()}/residents`).query({ search: email }).set(...admin()).expect(200);
      expect(active.body.total).toBe(0);
      const former = await http(app).get(`${base()}/residents`).query({ search: email, status: 'former' }).set(...admin()).expect(200);
      expect(former.body.total).toBe(1);

      // La unidad quedó libre y puede desactivarse.
      const unit = await http(app)
        .patch(`${base()}/properties/${tower.units.get('101')}`)
        .set(...admin())
        .send({ isActive: false })
        .expect(200);
      expect(unit.body).toMatchObject({ isActive: false, activeOccupants: 0 });
    });

    it('no desactiva una unidad con residentes vinculados', async () => {
      const response = await http(app)
        .patch(`${base()}/properties/${units.get('101')}`)
        .set(...admin())
        .send({ isActive: false })
        .expect(409);
      expect(response.body.error.code).toBe('PROPERTY_OCCUPIED');
    });
  });
});
