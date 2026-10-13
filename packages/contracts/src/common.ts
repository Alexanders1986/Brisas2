import { z } from 'zod';

export const uuidSchema = z.uuid({ error: 'Identificador inválido' });

/** Fecha calendario sin zona horaria (AAAA-MM-DD). */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'La fecha no es válida');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'El correo es demasiado largo')
  .pipe(z.email({ error: 'Escribe un correo electrónico válido' }));

/** Celular o fijo: dígitos, espacios, +, - y paréntesis. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{7,20}$/, 'Escribe un número de teléfono válido');

/** Texto opcional: las cadenas vacías de los formularios se tratan como "sin valor". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((value) => (value === '' ? undefined : value))
    .optional();

/** Interpreta "true"/"false" de un query string (z.coerce.boolean trataría "false" como true). */
export const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .default(false);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortDirectionSchema = z.enum(['asc', 'desc']);

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Formato único de error que devuelve la API. */
export interface ApiErrorBody {
  error: {
    /** Código estable para que los clientes reaccionen (p. ej. DUPLICATE_PERSON). */
    code: string;
    /** Mensaje en español apto para mostrar al usuario. */
    message: string;
    /** Errores por campo en validaciones: { "person.email": "Escribe un correo válido" }. */
    fields?: Record<string, string>;
    details?: unknown;
    requestId?: string;
  };
}
