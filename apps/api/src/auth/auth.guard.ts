import { userSessions, users } from '@brisas/database';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import { IS_PUBLIC } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  /** Id de la sesión: permite revocar el acceso antes de que el token venza. */
  sid: string;
  typ: 'access';
}

/**
 * Guard global: toda ruta exige un access token válido salvo las marcadas con @Public().
 * Además de la firma se consulta la sesión, de modo que cerrar sesión, revocar un
 * dispositivo o desactivar una cuenta surte efecto de inmediato.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthorized();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw AppError.unauthorized();
    }
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) throw AppError.unauthorized();

    const [session] = await this.database.system((tx) =>
      tx
        .select({
          userId: users.id,
          isPlatformAdmin: users.isPlatformAdmin,
          mfaEnabled: users.mfaEnabled,
        })
        .from(userSessions)
        .innerJoin(users, eq(users.id, userSessions.userId))
        .where(
          and(
            eq(userSessions.id, payload.sid),
            eq(userSessions.userId, payload.sub),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, new Date()),
            eq(users.status, 'active'),
          ),
        ),
    );
    if (!session) throw AppError.unauthorized();

    request.auth = { ...session, sessionId: payload.sid };
    return true;
  }
}
