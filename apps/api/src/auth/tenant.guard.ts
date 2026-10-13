import { type PermissionKey, uuidSchema } from '@brisas/contracts';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { AccessService } from './access.service';
import { ANY_MEMBER, REQUIRED_PERMISSIONS } from './decorators';

/**
 * Autoriza el acceso a /tenants/:tenantId/…
 * 1. El usuario debe ser miembro activo de ese conjunto (si no, responde 404 para no
 *    revelar qué conjuntos existen).
 * 2. El conjunto debe estar activo.
 * 3. El usuario debe tener todos los permisos que declara la ruta.
 * El SuperAdmin de plataforma no recibe acceso implícito a los datos de los conjuntos.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;
    if (!auth) throw AppError.unauthorized();

    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS, targets);
    const anyMember = this.reflector.getAllAndOverride<boolean | undefined>(ANY_MEMBER, targets);
    if (!required?.length && !anyMember) {
      // Denegar por defecto: una ruta nueva sin permisos declarados no queda abierta por olvido.
      throw AppError.forbidden();
    }

    const tenantId = uuidSchema.safeParse(request.params.tenantId);
    if (!tenantId.success) throw AppError.notFound('No encontramos el conjunto.');

    const access = await this.database.system((tx) => this.access.tenantAccess(tx, auth.userId, tenantId.data));
    if (!access) throw AppError.notFound('No encontramos el conjunto.');
    if (access.tenantStatus !== 'active') {
      throw AppError.forbidden('TENANT_SUSPENDED', 'Este conjunto está desactivado. Comunícate con soporte.');
    }
    if (this.config.mfaRequiredForAdmins && !auth.mfaEnabled && AccessService.hasStaffRole(access.roles)) {
      throw AppError.forbidden(
        'MFA_ENROLLMENT_REQUIRED',
        'Para continuar activa la verificación en dos pasos en tu cuenta.',
      );
    }
    if (required?.some((permission) => !access.permissions.has(permission))) throw AppError.forbidden();

    request.tenant = {
      tenantId: tenantId.data,
      userId: auth.userId,
      roles: access.roles,
      permissions: access.permissions,
    };
    return true;
  }
}
