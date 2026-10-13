import { runMigrations } from '../migrate';
import { loadRootEnv, requireEnv } from './env';

async function main(): Promise<void> {
  loadRootEnv();
  await runMigrations({
    adminUrl: requireEnv('DATABASE_ADMIN_URL'),
    appPassword: process.env.APP_DB_PASSWORD,
  });
  console.log('Base de datos migrada y catálogos sincronizados.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
