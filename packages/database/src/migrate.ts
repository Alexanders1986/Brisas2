import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, escapeLiteral } from 'pg';
import * as schema from './schema';
import { seedBaseData, seedDemoData, type DemoSeedResult } from './seed';

export interface MigrationOptions {
  /** Conexión con privilegios de dueño del esquema. Nunca es la conexión de la API. */
  adminUrl: string;
  /** Si se indica, habilita el inicio de sesión del rol brisas_app con esta contraseña. */
  appPassword?: string;
}

/**
 * Deja la base de datos lista para la versión actual del código:
 * 1. aplica las migraciones SQL pendientes,
 * 2. reaplica las políticas de aislamiento por conjunto y los permisos del rol de la API,
 * 3. sincroniza los catálogos (planes, permisos, roles del sistema y plantillas).
 * Es idempotente: puede ejecutarse en cada despliegue.
 */
export async function runMigrations(options: MigrationOptions): Promise<void> {
  const pool = new Pool({ connectionString: options.adminUrl, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'migrations') });
    await pool.query('SELECT app.apply_security()');
    if (options.appPassword) {
      await pool.query(`ALTER ROLE brisas_app LOGIN PASSWORD ${escapeLiteral(options.appPassword)}`);
    }
    await seedBaseData(db);
  } finally {
    await pool.end();
  }
}

/** Carga los datos de demostración (solo desarrollo). No hace nada si ya existen. */
export async function seedDemo(adminUrl: string): Promise<DemoSeedResult> {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    return await seedDemoData(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
