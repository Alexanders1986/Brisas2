import type { PermissionKey } from '@brisas/contracts';
import {
  Controller,
  ExecutionContext,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { type AuthContext, type RequestMeta, type TenantContext, requestMeta } from '../common/request-context';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TenantGuard } from './tenant.guard';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSIONS = 'auth:requiredPermissions';
export const ANY_MEMBER = 'auth:anyMember';

/** Ruta sin autenticación. Solo para inicio de sesión, recuperación, invitaciones y salud. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Permisos que el usuario debe tener (todos) en el conjunto de la ruta. */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Ruta disponible para cualquier miembro activo del conjunto, sin permiso específico. */
export const AnyMember = () => SetMetadata(ANY_MEMBER, true);

/**
 * Controlador de recursos de un conjunto: /tenants/:tenantId/<ruta>.
 * El TenantGuard verifica la pertenencia y los permisos antes de llegar al handler;
 * una ruta sin @RequirePermissions ni @AnyMember se rechaza por defecto.
 */
export const TenantController = (path: string, tag: string) =>
  applyDecorators(
    Controller(`tenants/:tenantId/${path}`.replace(/\/$/, '')),
    UseGuards(TenantGuard),
    ApiTags(tag),
    ApiBearerAuth(),
    ApiParam({ name: 'tenantId', format: 'uuid', description: 'Identificador del conjunto residencial' }),
  );

/** Controlador exclusivo del SuperAdmin de plataforma. */
export const PlatformController = (path: string, tag: string) =>
  applyDecorators(
    Controller(`platform/${path}`.replace(/\/$/, '')),
    UseGuards(PlatformAdminGuard),
    ApiTags(tag),
    ApiBearerAuth(),
  );

export const Auth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new Error('@Auth() usado en una ruta pública');
  return auth;
});

export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext): TenantContext => {
  const tenant = context.switchToHttp().getRequest<Request>().tenant;
  if (!tenant) throw new Error('@CurrentTenant() usado fuera de un TenantController');
  return tenant;
});

export const Meta = createParamDecorator((_: unknown, context: ExecutionContext): RequestMeta =>
  requestMeta(context.switchToHttp().getRequest<Request>()),
);
