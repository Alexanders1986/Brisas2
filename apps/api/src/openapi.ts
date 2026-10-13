import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './bootstrap';

/** Genera docs/api/openapi.json a partir del código. Uso: npm run openapi -w @brisas/api */
async function main(): Promise<void> {
  process.env.MAIL_WORKER_DISABLED = 'true';
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const target = path.resolve(__dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`Especificación OpenAPI escrita en ${target}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
