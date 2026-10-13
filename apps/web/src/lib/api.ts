import type { ApiErrorBody, AuthTokensResponse } from '@brisas/contracts';

const BASE = '/api/v1';

/**
 * El access token vive solo en memoria: no queda en localStorage al alcance de un script
 * inyectado. La sesión persiste gracias a la cookie httpOnly del refresh token.
 */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Las rutas de autenticación no reintentan con refresh. */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return `${BASE}${path}${suffix ? `?${suffix}` : ''}`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Brisas-Client': 'web',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const { error } = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, error.code, error.message, error.fields, error.details);
  } catch {
    return new ApiError(response.status, 'NETWORK_ERROR', 'No fue posible comunicarse con el servidor. Inténtalo de nuevo.');
  }
}

/** Renueva el access token con la cookie de sesión. Varias llamadas simultáneas comparten un solo intento. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await send('/auth/refresh', { method: 'POST', body: {} });
        if (response.ok) {
          accessToken = ((await response.json()) as AuthTokensResponse).accessToken;
          return true;
        }
        // 409: otra pestaña está renovando la misma sesión; su cookie nueva ya llegó o está por llegar.
        if (response.status !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      accessToken = null;
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
    if (response.status === 401 && !options.skipRefresh && (await refreshSession())) {
      response = await send(path, options);
    }
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204 || response.status === 202) return undefined as T;
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
