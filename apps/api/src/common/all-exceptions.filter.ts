import type { ApiErrorBody } from '@brisas/contracts';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppError } from './errors';

const STATUS_CODES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'La solicitud no es válida.' },
  401: { code: 'UNAUTHENTICATED', message: 'Tu sesión no es válida. Inicia sesión de nuevo.' },
  403: { code: 'FORBIDDEN', message: 'No tienes permiso para realizar esta acción.' },
  404: { code: 'NOT_FOUND', message: 'No encontramos lo que buscas.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'La información enviada es demasiado grande.' },
};

/** Convierte cualquier excepción al formato único { error: { code, message, … } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId;

    const { status, body } = this.toResponse(exception);
    body.error.requestId = requestId;

    if (status >= 500) {
      // El detalle técnico queda en el log; al cliente solo le llega un mensaje genérico.
      this.logger.error(
        { requestId, method: request.method, path: request.path, message: (exception as Error)?.message },
        (exception as Error)?.stack,
      );
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            fields: exception.extra.fields,
            details: exception.extra.details,
          },
        },
      };
    }
    if (exception instanceof ZodValidationException) {
      const fields: Record<string, string> = {};
      for (const issue of (exception.getZodError() as ZodError).issues) {
        const path = issue.path.join('.') || '_';
        fields[path] ??= issue.message;
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Revisa los campos marcados e inténtalo de nuevo.', fields } },
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' },
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const known = STATUS_CODES[status];
      return {
        status,
        body: { error: known ?? { code: 'HTTP_ERROR', message: 'No fue posible completar la solicitud.' } },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Ocurrió un error inesperado. Inténtalo de nuevo; si persiste, contacta a soporte.',
        },
      },
    };
  }
}
