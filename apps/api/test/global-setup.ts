import { rmSync } from 'node:fs';
import { runMigrations } from '@brisas/database';
import { EXTERNAL_ADMIN_URL, TEST_ADMIN_URL, TEST_APP_PASSWORD, TEST_DB } from './test-env';

export interface PgServer {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

/** Prepara un PostgreSQL real y vacío, y le aplica las mismas migraciones que producción. */
export default async function globalSetup(): Promise<void> {
  if (!EXTERNAL_ADMIN_URL) {
    // embedded-postgres se publica solo como ES module; Node lo carga con require() nativo.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const EmbeddedPostgres = require('embedded-postgres').default as new (options: Record<string, unknown>) => PgServer;
    rmSync(TEST_DB.dataDir, { recursive: true, force: true });
    const server = new EmbeddedPostgres({
      databaseDir: TEST_DB.dataDir,
      user: TEST_DB.adminUser,
      password: TEST_DB.adminPassword,
      port: TEST_DB.port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase(TEST_DB.database);
    (globalThis as { __BRISAS_TEST_PG__?: PgServer }).__BRISAS_TEST_PG__ = server;
  }
  await runMigrations({ adminUrl: TEST_ADMIN_URL, appPassword: TEST_APP_PASSWORD });
}
