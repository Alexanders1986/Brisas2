import path from 'node:path';

/**
 * Base de datos de las pruebas. Por defecto se levanta un PostgreSQL embebido y vacío
 * (nunca toca la base de desarrollo). En CI se puede apuntar a un PostgreSQL ya
 * disponible con TEST_DATABASE_ADMIN_URL (una base vacía) y TEST_APP_DB_PASSWORD.
 */
export const TEST_DB = {
  port: 54330,
  database: 'brisas_test',
  adminUser: 'postgres',
  adminPassword: 'test_admin_pw',
  dataDir: path.join(__dirname, '..', '.tmp', 'pg-test'),
};

export const EXTERNAL_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
export const TEST_APP_PASSWORD = process.env.TEST_APP_DB_PASSWORD ?? 'test_app_pw';

export const TEST_ADMIN_URL =
  EXTERNAL_ADMIN_URL ??
  `postgres://${TEST_DB.adminUser}:${TEST_DB.adminPassword}@localhost:${TEST_DB.port}/${TEST_DB.database}`;

function appUrl(): string {
  const url = new URL(TEST_ADMIN_URL);
  url.username = 'brisas_app';
  url.password = TEST_APP_PASSWORD;
  return url.toString();
}
export const TEST_APP_URL = appUrl();

export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    DATABASE_ADMIN_URL: TEST_ADMIN_URL,
    WEB_URL: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'secreto-solo-para-pruebas-automatizadas-0123456789',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    MAIL_TRANSPORT: 'memory',
    MAIL_WORKER_DISABLED: 'true',
    MFA_REQUIRED_FOR_ADMINS: 'false',
    RATE_LIMIT_MULTIPLIER: '1000',
    TRUST_PROXY_HOPS: '0',
  });
}
