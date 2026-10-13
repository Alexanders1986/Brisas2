import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { AccessService } from './access.service';
import { AccountController } from './account.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', issuer: 'brisas-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'brisas-api' },
      }),
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccessService,
    IdentityService,
    TenantGuard,
    PlatformAdminGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AccessService, IdentityService, TenantGuard, PlatformAdminGuard, JwtModule],
})
export class AuthModule {}
