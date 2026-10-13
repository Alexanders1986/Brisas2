import { seedDemo } from '../migrate';
import { DEMO_PASSWORD } from '../seed';
import { loadRootEnv, requireEnv } from './env';

async function main(): Promise<void> {
  loadRootEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Los datos de demostración no se cargan en producción.');
  }
  const result = await seedDemo(requireEnv('DATABASE_ADMIN_URL'));
  if (!result.created) {
    console.log('Los datos de demostración ya existían; no se hicieron cambios.');
    return;
  }
  console.log('Datos de DEMOSTRACIÓN cargados. Cuentas disponibles (contraseña: %s):', DEMO_PASSWORD);
  for (const account of result.accounts) {
    console.log('  %s  →  %s', account.email.padEnd(34), account.description);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
