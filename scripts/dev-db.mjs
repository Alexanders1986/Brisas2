// PostgreSQL embebido para desarrollo local: no requiere Docker ni instalar PostgreSQL.
// Inicia el servidor, aplica migraciones y carga los datos de demostración la primera vez.
// En producción se usa un PostgreSQL administrado; este script no se despliega.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const adminUrl = new URL(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:54329/brisas');
const dataDir = path.join(root, '.data', 'postgres');
const database = adminUrl.pathname.slice(1);

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: decodeURIComponent(adminUrl.username),
  password: decodeURIComponent(adminUrl.password),
  port: Number(adminUrl.port),
  persistent: true,
  onLog: () => {},
  onError: (message) => {
    const text = String(message);
    if (/FATAL|PANIC/.test(text)) console.error(text.trim());
  },
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

/** ¿Ya hay un PostgreSQL atendiendo en el puerto? (p. ej. quedó vivo tras cerrar la terminal). */
async function alreadyRunning() {
  const { Client } = require(require.resolve('pg', { paths: [path.join(root, 'packages', 'database')] }));
  const probe = new URL(adminUrl);
  probe.pathname = '/postgres';
  const client = new Client({ connectionString: probe.toString(), connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

try {
  if (await alreadyRunning()) {
    console.log('PostgreSQL ya estaba en ejecución; se reutiliza.');
    // Mantiene vivo este proceso para que el resto del entorno de desarrollo siga corriendo.
    setInterval(() => {}, 2 ** 30);
  } else {
    const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
    if (firstRun) {
      console.log('Preparando PostgreSQL por primera vez…');
      await server.initialise();
    }
    await server.start();
    if (firstRun) await server.createDatabase(database);
  }

  const { runMigrations, seedDemo, DEMO_PASSWORD } = require('@brisas/database');
  await runMigrations({ adminUrl: adminUrl.toString(), appPassword: process.env.APP_DB_PASSWORD ?? 'brisas_app_dev' });

  const seeded = await seedDemo(adminUrl.toString());

  console.log(`PostgreSQL listo en el puerto ${adminUrl.port} (datos en .data/postgres).`);
  if (seeded.created) {
    console.log(`Datos de DEMOSTRACIÓN cargados. Contraseña de todas las cuentas: ${DEMO_PASSWORD}`);
    for (const account of seeded.accounts) console.log(`  ${account.email.padEnd(30)} ${account.description}`);
  }
} catch (error) {
  console.error('No fue posible iniciar la base de datos de desarrollo.');
  console.error(
    error ??
      `Revisa que el puerto ${adminUrl.port} esté libre. Si quedó un proceso "postgres" de una ejecución anterior, ciérralo desde el Administrador de tareas y vuelve a intentar.`,
  );
  await server.stop().catch(() => {});
  process.exit(1);
}
