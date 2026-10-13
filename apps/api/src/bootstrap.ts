import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';

/** Configuración HTTP compartida por el servidor real y por las pruebas de integración. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.trustProxyHops);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '200kb' });
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('Brisas · API de gestión residencial')
    .setDescription(
      [
        'API REST versionada de la plataforma.',
        '',
        '**Autenticación.** Envía `Authorization: Bearer <accessToken>`. El access token dura pocos minutos; ',
        'renuévalo con `POST /auth/refresh`.',
        '',
        '**Conjuntos.** Los recursos de un conjunto viven bajo `/tenants/{tenantId}/…`. El servidor valida en cada ',
        'petición que el usuario pertenezca al conjunto y tenga el permiso requerido.',
        '',
        '**Errores.** Todas las respuestas de error tienen la forma ',
        '`{ "error": { "code", "message", "fields"?, "details"?, "requestId" } }`. `code` es estable; `message` está ',
        'en español y puede mostrarse al usuario; `fields` trae los errores por campo.',
        '',
        '**Paginación.** Los listados aceptan `page` y `pageSize` y responden ',
        '`{ items, page, pageSize, total, totalPages }`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, options));
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // En producción los logs salen como JSON, listos para un agregador.
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', prefix: 'Brisas' }),
    bodyParser: false,
  });
  configureApp(app);
  if (!app.get(AppConfig).isProduction) {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
  return app;
}
