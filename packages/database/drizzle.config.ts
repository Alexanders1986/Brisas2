import { defineConfig } from 'drizzle-kit';

// Solo se usa para generar migraciones SQL a partir del esquema (no requiere conexión).
// Las migraciones se aplican con `npm run db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
