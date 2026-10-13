import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { AppConfig } from './config/app-config';

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get(AppConfig);
  await app.listen(config.port);
  const logger = new Logger('Inicio');
  logger.log(`API disponible en http://localhost:${config.port}/api/v1`);
  if (!config.isProduction) logger.log(`Documentación OpenAPI en http://localhost:${config.port}/api/docs`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
