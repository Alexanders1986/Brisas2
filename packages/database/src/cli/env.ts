import path from 'node:path';
import { config } from 'dotenv';

/** Carga el .env de la raíz del monorepo sin pisar variables ya definidas en el entorno. */
export function loadRootEnv(): void {
  config({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa el archivo .env (hay un ejemplo en .env.example).`);
  }
  return value;
}
