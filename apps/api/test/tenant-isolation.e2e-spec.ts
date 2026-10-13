import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
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
} from './helpers';
import { TEST_APP_URL } from './test-env';

/**
 * Seguridad multi-tenant: un usuario del Conjunto A nunca puede leer ni modificar
 * información del Conjunto B, ni por la API ni saltándose la API.
 */
describe('Aislamiento entre conjuntos', () => {
  let app: INestApplication;
  let scenario: Scenario;
  let unitA: string;
  let unitB: string;
  let personA: string;
  let personB: string;

  const routeA = () => `${API}/tenants/${scenario.tenantA.tenantId}`;
  const routeB = () => `${API}/tenants/${scenario.tenantB.tenantId}`;
  const asAdminA = () => bearer(scenario.tenantA.adminToken);

  beforeAll(async () => {
    app = await createTestApp();
    scenario = await createScenario(app);
    unitA = (await createTowerWithUnits(app, scenario.tenantA)).units.get('101')!;
    unitB = (await createTowerWithUnits(app, scenario.tenantB)).units.get('101')!;
    const createdA = await http(app).post(`${routeA()}/residents`).set(...asAdminA()).send(residentPayload(unitA)).expect(201);
    const createdB = await http(app)
      .post(`${routeB()}/residents`)
      .set(...bearer(scenario.tenantB.adminToken))
      .send(residentPayload(unitB))
      .expect(201);
    personA = createdA.body.personId;
    personB = createdB.body.personId;
  });

  afterAll(async () => {
    await scenario.pool.end();
    await app.close();
  });

  describe('por la API', () => {
    it('el administrador de A no puede consultar nada del conjunto B', async () => {
      for (const path of ['branding', 'dashboard', 'towers', 'properties', 'residents', `residents/${personB}`]) {
        const response = await http(app).get(`${routeB()}/${path}`).set(...asAdminA());
        // 404 y no 403: ni siquiera se confirma que el conjunto exista.
        expect({ path, status: response.status }).toEqual({ path, status: 404 });
      }
    });

    it('un id de B usado dentro de las rutas de A no encuentra nada (sin IDOR)', async () => {
      await http(app).get(`${routeA()}/residents/${personB}`).set(...asAdminA()).expect(404);
      await http(app)
        .put(`${routeA()}/residents/${personB}`)
        .set(...asAdminA())
        .send({ firstName: 'Intruso', lastName: 'Intruso' })
        .expect(404);
      await http(app).put(`${routeA()}/residents/${personB}/access`).set(...asAdminA()).send({ enabled: false }).expect(404);

      const untouched = await scenario.pool.query('SELECT first_name FROM persons WHERE id = $1', [personB]);
      expect(untouched.rows[0].first_name).toBe('Ana');
    });

    it('no se puede vincular un residente de A a una unidad de B', async () => {
      const response = await http(app).post(`${routeA()}/residents`).set(...asAdminA()).send(residentPayload(unitB)).expect(422);
      expect(response.body.error.code).toBe('PROPERTY_NOT_FOUND');
      const linked = await http(app)
        .post(`${routeA()}/residents`)
        .set(...asAdminA())
        .send({ ...residentPayload(unitA), person: undefined, existingPersonId: personB })
        .expect(404);
      expect(linked.body.error.code).toBe('NOT_FOUND');
    });

    it('los listados de A solo contienen datos de A', async () => {
      const residents = await http(app).get(`${routeA()}/residents`).set(...asAdminA()).expect(200);
      expect(residents.body.items.map((item: { personId: string }) => item.personId)).toEqual([personA]);
      const dashboard = await http(app).get(`${routeA()}/dashboard`).set(...asAdminA()).expect(200);
      expect(dashboard.body).toMatchObject({ activeResidents: 1, units: 4, occupiedUnits: 1, towers: 1 });
    });

    it('el SuperAdmin de plataforma no tiene acceso implícito a los datos de un conjunto', async () => {
      await http(app).get(`${routeA()}/residents`).set(...bearer(scenario.platformToken)).expect(404);
    });

    it('un administrador de conjunto no puede usar las rutas de plataforma', async () => {
      await http(app).get(`${API}/platform/tenants`).set(...asAdminA()).expect(403);
      await http(app)
        .put(`${API}/platform/tenants/${scenario.tenantB.tenantId}/status`)
        .set(...asAdminA())
        .send({ status: 'suspended' })
        .expect(403);
    });

    it('un conjunto desactivado deja de ser operable y se recupera al activarlo', async () => {
      const status = (value: string) =>
        http(app)
          .put(`${API}/platform/tenants/${scenario.tenantB.tenantId}/status`)
          .set(...bearer(scenario.platformToken))
          .send({ status: value })
          .expect(200);
      await status('suspended');
      const blocked = await http(app).get(`${routeB()}/residents`).set(...bearer(scenario.tenantB.adminToken)).expect(403);
      expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');
      await status('active');
      await http(app).get(`${routeB()}/residents`).set(...bearer(scenario.tenantB.adminToken)).expect(200);
    });
  });

  describe('permisos por rol', () => {
    it('un residente puede ver la información del conjunto, pero no el panel administrativo', async () => {
      const payload = residentPayload((await createTowerWithUnits(app, scenario.tenantA, 'Torre 2')).units.get('102')!, {
        sendInvitation: true,
      });
      await http(app).post(`${routeA()}/residents`).set(...asAdminA()).send(payload).expect(201);
      await acceptInvitation(app, payload.person.email);
      const resident = await login(app, payload.person.email);

      await http(app).get(`${routeA()}/branding`).set(...bearer(resident.accessToken)).expect(200);
      for (const path of ['dashboard', 'residents', 'towers', 'properties', 'residents/duplicates']) {
        const response = await http(app).get(`${routeA()}/${path}`).set(...bearer(resident.accessToken));
        expect({ path, status: response.status }).toEqual({ path, status: 403 });
      }
      await http(app)
        .post(`${routeA()}/residents`)
        .set(...bearer(resident.accessToken))
        .send(residentPayload(unitA))
        .expect(403);
    });
  });

  describe('en la base de datos (Row Level Security)', () => {
    let appPool: Pool;

    beforeAll(() => {
      // La misma conexión sin privilegios que usa la API.
      appPool = new Pool({ connectionString: TEST_APP_URL, max: 1 });
    });
    afterAll(() => appPool.end());

    const inTenant = async <T>(tenantId: string | null, work: (query: Pool['query']) => Promise<T>): Promise<T> => {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.scope', 'tenant', true), set_config('app.tenant_id', $1, true)`, [
          tenantId ?? '',
        ]);
        return await work(client.query.bind(client) as Pool['query']);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };

    it('sin contexto de conjunto una consulta no devuelve ninguna fila', async () => {
      const rows = await inTenant(null, (query) => query('SELECT id FROM persons'));
      expect(rows.rowCount).toBe(0);
      const tenants = await inTenant(null, (query) => query('SELECT id FROM tenants'));
      expect(tenants.rowCount).toBe(0);
    });

    it('una consulta sin filtro solo ve las filas del conjunto declarado', async () => {
      const rows = await inTenant(scenario.tenantA.tenantId, (query) => query('SELECT id, tenant_id FROM persons'));
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows.every((row) => row.tenant_id === scenario.tenantA.tenantId)).toBe(true);
      expect(rows.rows.map((row) => row.id)).not.toContain(personB);
    });

    it('no permite insertar ni mover filas hacia otro conjunto', async () => {
      await expect(
        inTenant(scenario.tenantA.tenantId, (query) =>
          query(`INSERT INTO towers (tenant_id, name) VALUES ($1, 'Torre intrusa')`, [scenario.tenantB.tenantId]),
        ),
      ).rejects.toThrow(/row-level security/);
      const moved = await inTenant(scenario.tenantA.tenantId, (query) =>
        query('UPDATE persons SET first_name = $1 WHERE id = $2', ['Intruso', personB]),
      );
      expect(moved.rowCount).toBe(0);
    });

    it('las claves foráneas compuestas impiden referencias cruzadas entre conjuntos', async () => {
      // Incluso con privilegios de superusuario (sin RLS) la integridad se mantiene.
      await expect(
        scenario.pool.query(
          `INSERT INTO property_occupancies (tenant_id, property_id, person_id, relationship, start_date)
           VALUES ($1, $2, $3, 'owner', '2026-01-01')`,
          [scenario.tenantA.tenantId, unitB, personA],
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it('la bitácora de auditoría es de solo inserción para la aplicación', async () => {
      await expect(appPool.query(`UPDATE audit_logs SET summary = 'alterado'`)).rejects.toThrow(/permission denied/);
      await expect(appPool.query('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
    });

    it('toda tabla con tenant_id tiene RLS activado y forzado', async () => {
      const unprotected = await scenario.pool.query(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      `);
      expect(unprotected.rows).toEqual([]);
    });

    it('el rol de la aplicación no es superusuario ni puede saltarse RLS', async () => {
      const role = await scenario.pool.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'brisas_app'`,
      );
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });
});
