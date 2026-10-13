import { randomUUID } from 'node:crypto';
import type { PermissionKey, RoleKey } from '@brisas/contracts';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Identidad autenticada que el AuthGuard adjunta a la petición. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
}

/** Conjunto sobre el que opera la petición y lo que el usuario puede hacer en él. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  roles: RoleKey[];
  permissions: ReadonlySet<PermissionKey>;
}

/** Datos de la petición que se guardan en auditoría. */
export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    auth?: AuthContext;
    tenant?: TenantContext;
  }
}

export function requestMeta(request: Request): RequestMeta {
  return {
    requestId: request.requestId,
    ip: request.ip ?? null,
    userAgent: request.get('user-agent')?.slice(0, 400) ?? null,
  };
}

/** Asigna un identificador a cada petición y deja un log estructurado al terminar. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.get('x-request-id');
    request.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader('x-request-id', request.requestId);

    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      // Se registra la ruta sin query string para no dejar datos personales en los logs.
      if (process.env.NODE_ENV !== 'production') {
        this.logger.log(`${request.method} ${request.path} ${response.statusCode} ${durationMs}ms`);
        return;
      }
      this.logger.log({
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs,
        userId: request.auth?.userId,
        tenantId: request.tenant?.tenantId,
      });
    });
    next();
  }
}
