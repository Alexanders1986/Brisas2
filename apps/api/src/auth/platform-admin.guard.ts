import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { AppConfig } from '../config/app-config';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw AppError.unauthorized();
    if (!auth.isPlatformAdmin) throw AppError.forbidden();
    if (this.config.mfaRequiredForAdmins && !auth.mfaEnabled) {
      throw AppError.forbidden(
        'MFA_ENROLLMENT_REQUIRED',
        'Para continuar activa la verificación en dos pasos en tu cuenta.',
      );
    }
    return true;
  }
}
