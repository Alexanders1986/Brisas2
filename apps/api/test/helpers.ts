import { randomUUID } from 'node:crypto';
import { hashPassword } from '@brisas/database';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailQueueService } from '../src/notifications/mail-queue.service';
import { MAIL_TRANSPORT, type MemoryMailTransport } from '../src/notifications/mail-transport';
import { TEST_ADMIN_URL } from './test-env';

export const PASSWORD = 'Clave-Segura-2026';
export const API = '/api/v1';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

/** Conexión de superusuario para preparar datos y verificar el estado real de la base. */
export function adminPool(): Pool {
  return new Pool({ connectionString: TEST_ADMIN_URL, max: 2 });
}

/** Sufijo único por archivo de pruebas, para que los datos de un archivo no choquen con otro. */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export async function createPlatformAdmin(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (email, display_name, password_hash, status, is_platform_admin)
     VALUES ($1, 'SuperAdmin de pruebas', $2, 'active', true)`,
    [email, await hashPassword(PASSWORD)],
  );
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Inicia sesión como cliente móvil para recibir el refresh token en el cuerpo. */
export async function login(app: INestApplication, email: string, password = PASSWORD): Promise<Tokens> {
  const response = await http(app).post(`${API}/auth/login`).send({ email, password, client: 'mobile' }).expect(200);
  expect(response.body.status).toBe('authenticated');
  return response.body as Tokens;
}

/** Procesa la cola de correos y devuelve los enviados hasta ahora. */
export async function flushMail(app: INestApplication) {
  const queue = app.get(MailQueueService);
  while ((await queue.processPending()) > 0);
  return app.get<MemoryMailTransport>(MAIL_TRANSPORT).sent;
}

/** Extrae el token del enlace del último correo enviado a un destinatario. */
export async function lastLinkToken(app: INestApplication, recipient: string): Promise<string> {
  const sent = await flushMail(app);
  const message = [...sent].reverse().find((item) => item.to === recipient);
  if (!message) throw new Error(`No se envió ningún correo a ${recipient}`);
  const token = /[?&]token=([\w-]+)/.exec(message.html)?.[1];
  if (!token) throw new Error('El correo no contiene un enlace con token');
  return token;
}

export async function acceptInvitation(app: INestApplication, email: string): Promise<void> {
  const token = await lastLinkToken(app, email);
  await http(app)
    .post(`${API}/auth/invitations/accept`)
    .send({ token, password: PASSWORD, acceptPrivacyPolicy: true })
    .expect(204);
}

export interface TestTenant {
  tenantId: string;
  slug: string;
  adminEmail: string;
  adminToken: string;
}

/** Crea un conjunto por la API, activa a su administrador con la invitación y le inicia sesión. */
export async function createTenant(app: INestApplication, platformToken: string, label: string): Promise<TestTenant> {
  const suffix = uniqueSuffix();
  const slug = `${label}-${suffix}`;
  const adminEmail = `admin-${slug}@pruebas.test`;
  const response = await http(app)
    .post(`${API}/platform/tenants`)
    .set(...bearer(platformToken))
    .send({
      name: `Conjunto ${label} ${suffix}`,
      slug,
      planKey: 'standard',
      admin: { firstName: 'Admin', lastName: label, email: adminEmail },
    })
    .expect(201);
  await acceptInvitation(app, adminEmail);
  const { accessToken } = await login(app, adminEmail);
  return { tenantId: response.body.id as string, slug, adminEmail, adminToken: accessToken };
}

export interface Scenario {
  pool: Pool;
  platformEmail: string;
  platformToken: string;
  tenantA: TestTenant;
  tenantB: TestTenant;
}

/** Dos conjuntos independientes con sus administradores: base de las pruebas de aislamiento. */
export async function createScenario(app: INestApplication): Promise<Scenario> {
  const pool = adminPool();
  const platformEmail = `superadmin-${uniqueSuffix()}@pruebas.test`;
  await createPlatformAdmin(pool, platformEmail);
  const { accessToken: platformToken } = await login(app, platformEmail);
  const tenantA = await createTenant(app, platformToken, 'alfa');
  const tenantB = await createTenant(app, platformToken, 'beta');
  return { pool, platformEmail, platformToken, tenantA, tenantB };
}

/** Crea una torre con unidades y devuelve los ids de las unidades por número. */
export async function createTowerWithUnits(app: INestApplication, tenant: TestTenant, name = 'Torre 1') {
  const base = `${API}/tenants/${tenant.tenantId}`;
  const tower = await http(app)
    .post(`${base}/towers`)
    .set(...bearer(tenant.adminToken))
    .send({ name, kind: 'tower' })
    .expect(201);
  await http(app)
    .post(`${base}/properties/generate`)
    .set(...bearer(tenant.adminToken))
    .send({ towerId: tower.body.id, fromFloor: 1, toFloor: 2, unitsPerFloor: 2 })
    .expect(200);
  const list = await http(app)
    .get(`${base}/properties`)
    .query({ towerId: tower.body.id })
    .set(...bearer(tenant.adminToken))
    .expect(200);
  const units = new Map<string, string>(
    (list.body.items as { number: string; id: string }[]).map((item) => [item.number, item.id]),
  );
  return { towerId: tower.body.id as string, units };
}

export function residentPayload(propertyId: string, overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  return {
    person: {
      firstName: 'Ana',
      lastName: `Prueba ${suffix}`,
      email: `ana-${suffix}@pruebas.test`,
      phone: '300 555 0100',
      documentType: 'CC',
      documentNumber: `DOC${suffix}`.toUpperCase(),
    },
    relationship: 'owner',
    propertyId,
    startDate: '2026-01-15',
    householdSize: 3,
    ...overrides,
  };
}
