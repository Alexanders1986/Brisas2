import { HttpException, HttpStatus } from '@nestjs/common';

interface AppErrorOptions {
  /** Errores por campo, con la ruta en notación de puntos. */
  fields?: Record<string, string>;
  details?: unknown;
}

/**
 * Error de negocio con código estable. Todo error que la API devuelve a propósito
 * pasa por aquí, de modo que los clientes siempre reciben el mismo formato.
 */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly extra: AppErrorOptions = {},
  ) {
    super(message, status);
  }

  static badRequest(code: string, message: string, options?: AppErrorOptions) {
    return new AppError(HttpStatus.BAD_REQUEST, code, message, options);
  }
  static unauthorized(code = 'UNAUTHENTICATED', message = 'Tu sesión no es válida. Inicia sesión de nuevo.') {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message);
  }
  static forbidden(code = 'FORBIDDEN', message = 'No tienes permiso para realizar esta acción.') {
    return new AppError(HttpStatus.FORBIDDEN, code, message);
  }
  static notFound(message = 'No encontramos lo que buscas.', code = 'NOT_FOUND') {
    return new AppError(HttpStatus.NOT_FOUND, code, message);
  }
  static conflict(code: string, message: string, options?: AppErrorOptions) {
    return new AppError(HttpStatus.CONFLICT, code, message, options);
  }
  static unprocessable(code: string, message: string, options?: AppErrorOptions) {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, options);
  }
  static tooManyRequests(code: string, message: string) {
    return new AppError(HttpStatus.TOO_MANY_REQUESTS, code, message);
  }
}

/** Violación de restricción única de PostgreSQL. */
export function isUniqueViolation(error: unknown): error is { code: '23505'; constraint?: string } {
  const candidate = (error as { cause?: unknown })?.cause ?? error;
  return typeof candidate === 'object' && candidate !== null && (candidate as { code?: string }).code === '23505';
}

export function uniqueViolationConstraint(error: unknown): string | undefined {
  const candidate = ((error as { cause?: unknown })?.cause ?? error) as { constraint?: string };
  return candidate?.constraint;
}
