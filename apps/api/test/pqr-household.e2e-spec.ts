import type { INestApplication } from '@nestjs/common';
import {
  API,
  type Scenario,
  acceptInvitation,
  bearer,
  createScenario,
  createTestApp,
  createTowerWithUnits,
  flushMail,
  http,
  login,
  residentPayload,
  uniqueSuffix,
} from './helpers';

interface Resident {
  email: string;
  token: string;
  unitId: string;
}

describe('Hogar, vehículos y PQR', () => {
  let app: INestApplication;
  let scenario: Scenario;
  let units: Map<string, string>;
  let ana: Resident;
  let beto: Resident;

  const base = () => `${API}/tenants/${scenario.tenantA.tenantId}`;
  const admin = () => bearer(scenario.tenantA.adminToken);

  const createResident = async (unitNumber: string, firstName: string): Promise<Resident> => {
    const email = `${firstName.toLowerCase()}-${uniqueSuffix()}@pruebas.test`;
    const unitId = units.get(unitNumber)!;
    await http(app)
      .post(`${base()}/residents`)
      .set(...admin())
      .send(residentPayload(unitId, { person: { firstName, lastName: 'Residente', email, phone: '300 555 0100' }, sendInvitation: true }))
      .expect(201);
    await acceptInvitation(app, email);
    return { email, unitId, token: (await login(app, email)).accessToken };
  };

  beforeAll(async () => {
    app = await createTestApp();
    scenario = await createScenario(app);
    ({ units } = await createTowerWithUnits(app, scenario.tenantA));
    ana = await createResident('101', 'Ana');
    beto = await createResident('102', 'Beto');
  });

  afterAll(async () => {
    await scenario.pool.end();
    await app.close();
  });

  describe('personas del hogar', () => {
    const member = { firstName: 'Sofía', lastName: 'Residente', kinship: 'child', gender: 'female', birthDate: '2016-03-09' };
    const membersUrl = (resident: Resident) => `${base()}/properties/${resident.unitId}/household-members`;
    let memberId: string;

    it('el residente ve su unidad y puede registrar a quienes viven con él', async () => {
      const mine = await http(app).get(`${base()}/my/household`).set(...bearer(ana.token)).expect(200);
      expect(mine.body.units).toHaveLength(1);
      expect(mine.body.units[0]).toMatchObject({ propertyLabel: 'Torre 1 · Apto 101', canManage: true, members: [], vehicles: [] });
      expect(mine.body.units[0].residents).toEqual([expect.objectContaining({ fullName: 'Ana Residente', relationship: 'owner' })]);

      const created = await http(app).post(membersUrl(ana)).set(...bearer(ana.token)).send(member).expect(201);
      expect(created.body).toMatchObject({ ...member, phone: null, receivesNotifications: false });
      memberId = created.body.id;
    });

    it('el celular es opcional, pero se exige un contacto para recibir notificaciones', async () => {
      const withoutContact = await http(app)
        .post(membersUrl(ana))
        .set(...bearer(ana.token))
        .send({ ...member, firstName: 'Mario', kinship: 'spouse', gender: 'male', birthDate: '1985-01-20', receivesNotifications: true })
        .expect(400);
      expect(withoutContact.body.error.fields.phone).toBeDefined();

      const updated = await http(app)
        .put(`${membersUrl(ana)}/${memberId}`)
        .set(...bearer(ana.token))
        .send({ ...member, phone: '311 555 0102', receivesNotifications: true })
        .expect(200);
      expect(updated.body).toMatchObject({ phone: '311 555 0102', receivesNotifications: true });

      const invalid = await http(app).post(membersUrl(ana)).set(...bearer(ana.token)).send({ ...member, kinship: 'primo', birthDate: '2999-01-01' }).expect(400);
      expect(Object.keys(invalid.body.error.fields).sort()).toEqual(['birthDate', 'kinship']);
    });

    it('un vecino no puede ver ni modificar el hogar de otra unidad', async () => {
      await http(app).get(`${base()}/properties/${ana.unitId}/household`).set(...bearer(beto.token)).expect(404);
      await http(app).post(membersUrl(ana)).set(...bearer(beto.token)).send(member).expect(404);
      // Ni usando su propia unidad en la ruta con el id de una persona ajena.
      await http(app).put(`${membersUrl(beto)}/${memberId}`).set(...bearer(beto.token)).send(member).expect(404);
      await http(app).delete(`${membersUrl(beto)}/${memberId}`).set(...bearer(beto.token)).expect(404);
    });

    it('la administración puede consultar y corregir el hogar de cualquier unidad', async () => {
      const household = await http(app).get(`${base()}/properties/${ana.unitId}/household`).set(...admin()).expect(200);
      expect(household.body.members).toHaveLength(1);
      expect(household.body.canManage).toBe(true);
      await http(app).delete(`${membersUrl(ana)}/${memberId}`).set(...admin()).expect(204);
      const after = await http(app).get(`${base()}/my/household`).set(...bearer(ana.token)).expect(200);
      expect(after.body.units[0].members).toEqual([]);
    });
  });

  describe('vehículos', () => {
    const vehiclesUrl = (resident: Resident) => `${base()}/properties/${resident.unitId}/vehicles`;
    const plate = `T${uniqueSuffix().slice(0, 5)}`.toUpperCase();

    it('registra el detalle del vehículo y normaliza la placa', async () => {
      const created = await http(app)
        .post(vehiclesUrl(ana))
        .set(...bearer(ana.token))
        .send({ kind: 'car', powertrain: 'hybrid', plate: ` ${plate.slice(0, 3).toLowerCase()}-${plate.slice(3)} `, brand: 'Toyota', model: 'Corolla', modelYear: 2023, color: 'Gris' })
        .expect(201);
      expect(created.body).toMatchObject({ kind: 'car', powertrain: 'hybrid', plate, brand: 'Toyota', modelYear: 2023, color: 'Gris' });
    });

    it('exige placa a carros y motos, no a bicicletas', async () => {
      const moto = await http(app).post(vehiclesUrl(ana)).set(...bearer(ana.token)).send({ kind: 'motorcycle', powertrain: 'electric', color: 'Negro' }).expect(400);
      expect(moto.body.error.fields.plate).toBeDefined();
      const bike = await http(app).post(vehiclesUrl(ana)).set(...bearer(ana.token)).send({ kind: 'bicycle', powertrain: 'electric', color: 'Azul' }).expect(201);
      expect(bike.body).toMatchObject({ kind: 'bicycle', powertrain: 'electric', plate: null });
    });

    it('no permite la misma placa en dos unidades', async () => {
      const response = await http(app).post(vehiclesUrl(beto)).set(...bearer(beto.token)).send({ kind: 'car', powertrain: 'combustion', plate, color: 'Rojo' }).expect(409);
      expect(response.body.error).toMatchObject({ code: 'PLATE_TAKEN', fields: { plate: expect.any(String) } });
    });

    it('un vecino no puede quitar el vehículo de otra unidad', async () => {
      const mine = await http(app).get(`${base()}/my/household`).set(...bearer(ana.token)).expect(200);
      const vehicleId = mine.body.units[0].vehicles[0].id;
      await http(app).delete(`${vehiclesUrl(beto)}/${vehicleId}`).set(...bearer(beto.token)).expect(404);
      await http(app).delete(`${vehiclesUrl(ana)}/${vehicleId}`).set(...bearer(beto.token)).expect(404);
      await http(app).delete(`${vehiclesUrl(ana)}/${vehicleId}`).set(...bearer(ana.token)).expect(204);
    });
  });

  describe('mascotas', () => {
    const petsUrl = (resident: Resident) => `${base()}/properties/${resident.unitId}/pets`;
    const pet = { species: 'dog', name: 'Luna', breed: 'Criollo', sex: 'female', color: 'Café', vaccinesUpToDate: true };

    it('el residente registra, edita y quita sus mascotas', async () => {
      const created = await http(app).post(petsUrl(ana)).set(...bearer(ana.token)).send(pet).expect(201);
      expect(created.body).toMatchObject(pet);

      const invalid = await http(app).post(petsUrl(ana)).set(...bearer(ana.token)).send({ species: 'dragón', name: '' }).expect(400);
      expect(Object.keys(invalid.body.error.fields).sort()).toEqual(['name', 'species']);

      const updated = await http(app)
        .put(`${petsUrl(ana)}/${created.body.id}`)
        .set(...bearer(ana.token))
        .send({ species: 'dog', name: 'Luna', vaccinesUpToDate: false })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Luna', breed: null, sex: null, color: null, vaccinesUpToDate: false });

      const mine = await http(app).get(`${base()}/my/household`).set(...bearer(ana.token)).expect(200);
      expect(mine.body.units[0].pets).toEqual([expect.objectContaining({ id: created.body.id, name: 'Luna' })]);

      // Un vecino no puede tocarla, ni por la unidad ajena ni por la propia.
      await http(app).post(petsUrl(ana)).set(...bearer(beto.token)).send(pet).expect(404);
      await http(app).delete(`${petsUrl(beto)}/${created.body.id}`).set(...bearer(beto.token)).expect(404);
      await http(app).delete(`${petsUrl(ana)}/${created.body.id}`).set(...bearer(ana.token)).expect(204);
      const after = await http(app).get(`${base()}/properties/${ana.unitId}/household`).set(...admin()).expect(200);
      expect(after.body.pets).toEqual([]);
    });
  });

  describe('PQR', () => {
    const pqr = { type: 'complaint', category: 'Convivencia y ruido', subject: 'Ruido en las noches', description: 'El apartamento de arriba hace ruido después de las 11 p. m.' };
    let pqrId: string;
    const mailTo = async (recipient: string) => (await flushMail(app)).filter((message) => message.to === recipient);

    it('el residente radica y recibe un número de radicado y un correo de confirmación', async () => {
      const created = await http(app).post(`${base()}/pqrs`).set(...bearer(ana.token)).send(pqr).expect(201);
      expect(created.body.filingNumber).toMatch(/^PQR-\d{4}-000001$/);
      expect(created.body).toMatchObject({
        status: 'pending_review',
        priority: 'medium',
        requesterName: 'Ana Residente',
        propertyLabel: 'Torre 1 · Apto 101',
        canManage: false,
        canComment: true,
      });
      expect(created.body.history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'pending_review' })]);
      pqrId = created.body.id;

      const mail = await mailTo(ana.email);
      expect(mail.at(-1)!.subject).toBe(`Recibimos tu solicitud ${created.body.filingNumber}`);
      expect(mail.at(-1)!.html).toContain(`/pqr/${pqrId}`);
    });

    it('valida la solicitud y no acepta una unidad ajena', async () => {
      const invalid = await http(app).post(`${base()}/pqrs`).set(...bearer(ana.token)).send({ type: 'x', category: 'Inventada', subject: 'a', description: 'b' }).expect(400);
      expect(Object.keys(invalid.body.error.fields).sort()).toEqual(['category', 'description', 'subject', 'type']);
      const foreign = await http(app).post(`${base()}/pqrs`).set(...bearer(ana.token)).send({ ...pqr, propertyId: beto.unitId }).expect(422);
      expect(foreign.body.error.code).toBe('PROPERTY_NOT_YOURS');
    });

    it('asigna radicados consecutivos y únicos aunque lleguen al mismo tiempo', async () => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          http(app).post(`${base()}/pqrs`).set(...bearer(beto.token)).send({ ...pqr, subject: `Solicitud simultánea ${index}` }),
        ),
      );
      const numbers = responses.map((response) => response.body.filingNumber as string).sort();
      expect(new Set(numbers).size).toBe(6);
      expect(numbers.map((value) => Number(value.slice(-6)))).toEqual([2, 3, 4, 5, 6, 7]);
    });

    it('cada residente solo ve sus propias solicitudes', async () => {
      const anaList = await http(app).get(`${base()}/pqrs`).set(...bearer(ana.token)).expect(200);
      expect(anaList.body.items.map((item: { id: string }) => item.id)).toEqual([pqrId]);
      await http(app).get(`${base()}/pqrs/${pqrId}`).set(...bearer(beto.token)).expect(404);
      await http(app).post(`${base()}/pqrs/${pqrId}/comments`).set(...bearer(beto.token)).send({ body: 'Intruso' }).expect(404);
      await http(app).get(`${base()}/pqrs/assignees`).set(...bearer(ana.token)).expect(403);
      await http(app).get(`${base()}/reports/pqr`).query({ from: '2020-01-01', to: '2099-12-31' }).set(...bearer(ana.token)).expect(403);
    });

    it('el residente no puede cambiar el estado ni escribir notas internas', async () => {
      await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...bearer(ana.token)).send({ status: 'resolved' }).expect(403);
      const commented = await http(app)
        .post(`${base()}/pqrs/${pqrId}/comments`)
        .set(...bearer(ana.token))
        .send({ body: 'Sigue pasando', isInternal: true })
        .expect(200);
      expect(commented.body.comments).toEqual([expect.objectContaining({ body: 'Sigue pasando', isInternal: false, fromStaff: false })]);
      expect(commented.body.status).toBe('pending_review');
      // El comentario del residente avisa a la administración.
      const adminMail = await mailTo(scenario.tenantA.adminEmail);
      expect(adminMail.at(-1)!.subject).toContain('Nuevo comentario en la solicitud');
    });

    it('la administración ve todas, filtra y busca por radicado', async () => {
      const all = await http(app).get(`${base()}/pqrs`).set(...admin()).expect(200);
      expect(all.body.total).toBe(7);
      const byNumber = await http(app).get(`${base()}/pqrs`).query({ search: '000001' }).set(...admin()).expect(200);
      expect(byNumber.body.items.map((item: { id: string }) => item.id)).toEqual([pqrId]);
      const byRequester = await http(app).get(`${base()}/pqrs`).query({ search: 'Beto', status: 'pending_review' }).set(...admin()).expect(200);
      expect(byRequester.body.total).toBe(6);
      const none = await http(app).get(`${base()}/pqrs`).query({ to: '2020-01-01' }).set(...admin()).expect(200);
      expect(none.body.total).toBe(0);
    });

    it('la nota interna no llega al residente; la respuesta pública sí, y pone la solicitud en trámite', async () => {
      await http(app).post(`${base()}/pqrs/${pqrId}/comments`).set(...admin()).send({ body: 'Hablar con el 201 antes de responder', isInternal: true }).expect(200);
      const afterNote = await http(app).get(`${base()}/pqrs/${pqrId}`).set(...bearer(ana.token)).expect(200);
      expect(JSON.stringify(afterNote.body)).not.toContain('Hablar con el 201');
      expect(afterNote.body).toMatchObject({ status: 'pending_review', firstResponseAt: null });

      const replied = await http(app).post(`${base()}/pqrs/${pqrId}/comments`).set(...admin()).send({ body: 'Ya hablamos con el vecino.' }).expect(200);
      expect(replied.body.status).toBe('in_progress');
      expect(replied.body.firstResponseAt).toEqual(expect.any(String));
      expect(replied.body.comments.filter((item: { isInternal: boolean }) => item.isInternal)).toHaveLength(1);

      const residentView = await http(app).get(`${base()}/pqrs/${pqrId}`).set(...bearer(ana.token)).expect(200);
      expect(residentView.body.comments.map((item: { body: string }) => item.body)).toEqual(['Sigue pasando', 'Ya hablamos con el vecino.']);
      expect(residentView.body.history.map((item: { toStatus: string }) => item.toStatus)).toEqual(['pending_review', 'in_progress']);
      expect((await mailTo(ana.email)).at(-1)!.subject).toContain('Nueva respuesta en tu solicitud');
    });

    it('asigna responsable solo entre el personal y respeta los cambios de estado válidos', async () => {
      const me = await http(app).get(`${API}/auth/me`).set(...admin()).expect(200);
      const residentMe = await http(app).get(`${API}/auth/me`).set(...bearer(ana.token)).expect(200);
      const assignees = await http(app).get(`${base()}/pqrs/assignees`).set(...admin()).expect(200);
      expect(assignees.body).toEqual([{ userId: me.body.id, name: 'Admin alfa' }]);

      const notStaff = await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...admin()).send({ assigneeUserId: residentMe.body.id }).expect(422);
      expect(notStaff.body.error.code).toBe('ASSIGNEE_NOT_ALLOWED');
      const assigned = await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...admin()).send({ assigneeUserId: me.body.id, priority: 'high' }).expect(200);
      expect(assigned.body).toMatchObject({ assigneeName: 'Admin alfa', priority: 'high' });

      const resolved = await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...admin()).send({ status: 'resolved', note: 'El vecino se comprometió a no hacer ruido.' }).expect(200);
      expect(resolved.body.resolvedAt).toEqual(expect.any(String));
      const resolvedMail = (await mailTo(ana.email)).at(-1)!;
      expect(resolvedMail.subject).toContain('fue resuelta');
      expect(resolvedMail.html).toContain('El vecino se comprometió');

      const closed = await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...admin()).send({ status: 'closed' }).expect(200);
      expect(closed.body).toMatchObject({ status: 'closed', canComment: false });
      const reopen = await http(app).patch(`${base()}/pqrs/${pqrId}`).set(...admin()).send({ status: 'in_progress' }).expect(409);
      expect(reopen.body.error.code).toBe('INVALID_STATUS_CHANGE');
      const late = await http(app).post(`${base()}/pqrs/${pqrId}/comments`).set(...bearer(ana.token)).send({ body: 'Gracias' }).expect(409);
      expect(late.body.error.code).toBe('PQR_CLOSED');
    });

    it('cada hecho genera un solo correo', async () => {
      const subjects = (await mailTo(ana.email)).map((message) => message.subject).filter((subject) => subject.includes('solicitud'));
      expect(subjects).toHaveLength(4); // radicada, respondida, resuelta, cerrada
      expect(new Set(subjects).size).toBe(4);
    });

    it('el reporte cuadra con lo radicado en el periodo', async () => {
      const report = await http(app).get(`${base()}/reports/pqr`).query({ from: '2020-01-01', to: '2099-12-31' }).set(...admin()).expect(200);
      expect(report.body).toMatchObject({ received: 7, pending: 6, resolved: 1 });
      expect(report.body.avgFirstResponseHours).toEqual(expect.any(Number));
      expect(report.body.byCategory).toEqual([{ label: 'Convivencia y ruido', count: 7 }]);
      expect(report.body.byTower).toEqual([{ label: 'Torre 1', count: 7 }]);
      expect(report.body.byStatus).toEqual(expect.arrayContaining([{ status: 'closed', count: 1 }, { status: 'pending_review', count: 6 }]));
      expect(report.body.trend).toEqual([expect.objectContaining({ received: 7, resolved: 1 })]);

      const empty = await http(app).get(`${base()}/reports/pqr`).query({ from: '2020-01-01', to: '2020-12-31' }).set(...admin()).expect(200);
      expect(empty.body).toMatchObject({ received: 0, avgFirstResponseHours: null, trend: [] });
      await http(app).get(`${base()}/reports/pqr`).query({ from: '2026-12-31', to: '2026-01-01' }).set(...admin()).expect(400);
    });

    it('el panel muestra las PQR pendientes solo a quien puede verlas', async () => {
      const dashboard = await http(app).get(`${base()}/dashboard`).set(...admin()).expect(200);
      expect(dashboard.body).toMatchObject({ pqrPendingReview: 6, pqrInProgress: 0 });
    });
  });
});
