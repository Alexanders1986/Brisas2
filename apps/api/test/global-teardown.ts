import type { PgServer } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __BRISAS_TEST_PG__?: PgServer }).__BRISAS_TEST_PG__?.stop();
}
