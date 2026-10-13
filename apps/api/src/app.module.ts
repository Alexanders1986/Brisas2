import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RequestContextMiddleware } from './common/request-context';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { ResidentsModule } from './residents/residents.module';
import { TenancyModule } from './tenancy/tenancy.module';

/**
 * Monolito modular. Cada módulo de negocio (platform, tenancy, residents…) expone sus
 * controladores y servicios; la infraestructura compartida (configuración, base de
 * datos, auditoría, notificaciones, autenticación) es global.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    NotificationsModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      // Límite general por IP; las rutas de autenticación declaran límites más estrictos.
      useFactory: (config: AppConfig) => [{ name: 'default', ttl: 60_000, limit: 300 * config.rateLimitMultiplier }],
    }),
    AuthModule,
    PlatformModule,
    TenancyModule,
    ResidentsModule,
  ],
  controllers: [HealthController],
  providers: [
    // El orden importa: primero el límite de peticiones, luego la autenticación (AuthModule).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
