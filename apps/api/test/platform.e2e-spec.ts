import type { INestApplication } from '@nestjs/common';
import { API, type Scenario, bearer, createScenario, createTestApp, flushMail, http, uniqueSuffix } from './helpers';

describe('Plataforma: gestión de conjuntos', () => {
  let app: INestApplication;
  let scenario: Scenario;
  const platform = () => bearer(scenario.platformToken);

  beforeAll(async () => {
    app = await createTestApp();
    scenario = await createScenario(app);
  });

  afterAll(async () => {
    await scenario.pool.end();
    await app.close();
  });

  it('crea el conjunto con su configuración, categorías documentales y administrador invitado', async () => {
    const slug = `nuevo-${uniqueSuffix()}`;
    const adminEmail = `admin-${slug}@pruebas.test`;
    const created = await http(app)
      .post(`${API}/platform/tenants`)
      .set(...platform())
      .send({ name: 'Conjunto Nuevo', slug, city: 'Cali', admin: { firstName: 'Nora', lastName: 'Vélez', email: adminEmail } })
      .expect(201);
    expect(created.body).toMatchObject({ slug, status: 'active', planKey: 'basic', city: 'Cali', unitsCount: 0 });

    const categories = await scenario.pool.query('SELECT count(*)::int AS total FROM document_categories WHERE tenant_id = $1', [
      created.body.id,
    ]);
    expect(categories.rows[0].total).toBe(7);

    const mail = (await flushMail(app)).filter((message) => message.to === adminEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe('Te invitaron a Conjunto Nuevo');
  });

  it('escapa el contenido de las plantillas de correo', async () => {
    const slug = `xss-${uniqueSuffix()}`;
    const adminEmail = `admin-${slug}@pruebas.test`;
    await http(app)
      .post(`${API}/platform/tenants`)
      .set(...platform())
      .send({ name: 'Torres <script>alert(1)</script>', slug, admin: { firstName: 'Eva', lastName: 'Luna', email: adminEmail } })
      .expect(201);
    const [message] = (await flushMail(app)).filter((item) => item.to === adminEmail);
    expect(message!.html).not.toContain('<script>');
    expect(message!.html).toContain('&#60;script&#62;');
  });

  it('rechaza identificadores repetidos o con formato inválido', async () => {
    const admin = { firstName: 'Nora', lastName: 'Vélez', email: `otra-${uniqueSuffix()}@pruebas.test` };
    const taken = await http(app)
      .post(`${API}/platform/tenants`)
      .set(...platform())
      .send({ name: 'Repetido', slug: scenario.tenantA.slug, admin })
      .expect(409);
    expect(taken.body.error).toMatchObject({ code: 'SLUG_TAKEN', fields: { slug: expect.any(String) } });

    const invalid = await http(app)
      .post(`${API}/platform/tenants`)
      .set(...platform())
      .send({ name: 'Inválido', slug: 'Con Espacios', admin })
      .expect(400);
    expect(invalid.body.error.fields.slug).toBeDefined();
  });

  it('lista con búsqueda y paginación, y actualiza el plan', async () => {
    const found = await http(app).get(`${API}/platform/tenants`).query({ search: scenario.tenantA.slug }).set(...platform()).expect(200);
    expect(found.body.items).toEqual([expect.objectContaining({ id: scenario.tenantA.tenantId })]);

    const page = await http(app).get(`${API}/platform/tenants`).query({ pageSize: 1 }).set(...platform()).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBeGreaterThanOrEqual(2);

    const updated = await http(app)
      .patch(`${API}/platform/tenants/${scenario.tenantA.tenantId}`)
      .set(...platform())
      .send({ planKey: 'premium' })
      .expect(200);
    expect(updated.body.planKey).toBe('premium');

    const metrics = await http(app).get(`${API}/platform/metrics`).set(...platform()).expect(200);
    expect(metrics.body.tenantsActive).toBeGreaterThanOrEqual(2);
  });

  it('aplica el límite de unidades del plan', async () => {
    await http(app)
      .patch(`${API}/platform/tenants/${scenario.tenantB.tenantId}`)
      .set(...platform())
      .send({ planKey: 'basic' })
      .expect(200);
    const base = `${API}/tenants/${scenario.tenantB.tenantId}`;
    const tower = await http(app).post(`${base}/towers`).set(...bearer(scenario.tenantB.adminToken)).send({ name: 'Torre única' }).expect(201);
    const overLimit = await http(app)
      .post(`${base}/properties/generate`)
      .set(...bearer(scenario.tenantB.adminToken))
      .send({ towerId: tower.body.id, fromFloor: 1, toFloor: 11, unitsPerFloor: 10 })
      .expect(422);
    expect(overLimit.body.error.code).toBe('PLAN_LIMIT_REACHED');
    const none = await http(app).get(`${base}/properties`).set(...bearer(scenario.tenantB.adminToken)).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('expone la documentación OpenAPI con todas las rutas', async () => {
    const { buildOpenApiDocument } = await import('../src/bootstrap');
    const document = buildOpenApiDocument(app);
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/login',
        '/api/v1/platform/tenants',
        '/api/v1/tenants/{tenantId}/residents',
        '/api/v1/tenants/{tenantId}/properties/generate',
      ]),
    );
    const login = document.paths['/api/v1/auth/login']!.post!;
    expect(JSON.stringify(login.requestBody)).toContain('LoginDto');
  });

  it('responde el estado de salud sin autenticación', async () => {
    await http(app).get(`${API}/health`).expect(200, { status: 'ok' });
  });
});
