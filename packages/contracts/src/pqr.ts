import { z } from 'zod';
import { dateOnlySchema, optionalText, paginationQuerySchema, queryBooleanSchema, uuidSchema } from './common';

export const PQR_TYPES = ['petition', 'complaint', 'claim', 'suggestion'] as const;
export type PqrType = (typeof PQR_TYPES)[number];
export const PQR_TYPE_LABELS: Record<PqrType, string> = {
  petition: 'Petición',
  complaint: 'Queja',
  claim: 'Reclamo',
  suggestion: 'Sugerencia',
};
export const PQR_TYPE_HINTS: Record<PqrType, string> = {
  petition: 'Pides información o que se haga algo',
  complaint: 'Algo te molesta o incomoda',
  claim: 'Algo salió mal y pides que se corrija',
  suggestion: 'Tienes una idea para mejorar',
};

export const PQR_STATUSES = ['pending_review', 'in_progress', 'resolved', 'closed'] as const;
export type PqrStatus = (typeof PQR_STATUSES)[number];
export const PQR_STATUS_LABELS: Record<PqrStatus, string> = {
  pending_review: 'Por revisar',
  in_progress: 'En trámite',
  resolved: 'Resuelta',
  closed: 'Cerrada',
};

/** Cambios de estado permitidos. Una PQR cerrada no se vuelve a abrir. */
export const PQR_TRANSITIONS: Record<PqrStatus, readonly PqrStatus[]> = {
  pending_review: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

export const PQR_PRIORITIES = ['low', 'medium', 'high'] as const;
export type PqrPriority = (typeof PQR_PRIORITIES)[number];
export const PQR_PRIORITY_LABELS: Record<PqrPriority, string> = { low: 'Baja', medium: 'Media', high: 'Alta' };

export const PQR_CATEGORIES = [
  'Mantenimiento y daños',
  'Zonas comunes',
  'Convivencia y ruido',
  'Seguridad y portería',
  'Parqueaderos',
  'Mascotas',
  'Aseo y basuras',
  'Administración y pagos',
  'Otro',
] as const;

export const createPqrSchema = z.object({
  type: z.enum(PQR_TYPES, { error: 'Selecciona el tipo de solicitud' }),
  category: z.enum(PQR_CATEGORIES, { error: 'Selecciona una categoría' }),
  subject: z.string().trim().min(5, 'Escribe un asunto de al menos 5 caracteres').max(160),
  description: z.string().trim().min(10, 'Cuéntanos un poco más (mínimo 10 caracteres)').max(5000),
  /** Unidad a la que se refiere la solicitud; debe ser una unidad del solicitante. */
  propertyId: z.union([z.literal('').transform(() => undefined), uuidSchema]).optional(),
});
export type CreatePqrInput = z.input<typeof createPqrSchema>;

export const pqrCommentSchema = z.object({
  body: z.string().trim().min(1, 'Escribe un mensaje').max(5000),
  /** Nota interna: solo la ve el personal del conjunto. */
  isInternal: z.boolean().default(false),
});
export type PqrCommentInput = z.input<typeof pqrCommentSchema>;

export const updatePqrSchema = z
  .object({
    status: z.enum(PQR_STATUSES).optional(),
    priority: z.enum(PQR_PRIORITIES).optional(),
    /** null quita el responsable. */
    assigneeUserId: uuidSchema.nullable().optional(),
    /** Explicación del cambio de estado; el residente la ve. */
    note: optionalText(500),
  })
  .refine((value) => value.status || value.priority || value.assigneeUserId !== undefined, {
    error: 'Indica qué quieres cambiar',
  });
export type UpdatePqrInput = z.input<typeof updatePqrSchema>;

export const listPqrQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(PQR_STATUSES).optional(),
  type: z.enum(PQR_TYPES).optional(),
  priority: z.enum(PQR_PRIORITIES).optional(),
  towerId: uuidSchema.optional(),
  /** Número de radicado, asunto o nombre del solicitante. */
  search: z.string().trim().max(100).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Solo las que tengo asignadas. */
  assignedToMe: queryBooleanSchema,
});

export const pqrReportQuerySchema = z
  .object({ from: dateOnlySchema, to: dateOnlySchema })
  .refine((value) => value.to >= value.from, { error: 'La fecha final debe ser posterior a la inicial', path: ['to'] });

// ---------------------------------------------------------------- respuestas

export interface PqrListItem {
  id: string;
  filingNumber: string;
  type: PqrType;
  category: string;
  subject: string;
  priority: PqrPriority;
  status: PqrStatus;
  requesterName: string;
  propertyLabel: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PqrComment {
  id: string;
  authorName: string;
  /** true si lo escribió el personal del conjunto; false si lo escribió el solicitante. */
  fromStaff: boolean;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface PqrStatusChange {
  id: string;
  fromStatus: PqrStatus | null;
  toStatus: PqrStatus;
  changedByName: string | null;
  note: string | null;
  createdAt: string;
}

export interface PqrDetail extends PqrListItem {
  description: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: PqrComment[];
  history: PqrStatusChange[];
  /** Quien consulta puede asignar, cambiar estado y escribir notas internas. */
  canManage: boolean;
  /** Quien consulta puede escribir en la conversación. */
  canComment: boolean;
}

export interface PqrAssignee {
  userId: string;
  name: string;
}

export interface CountByLabel {
  label: string;
  count: number;
}

/**
 * Indicadores de PQR. Todos se calculan sobre el mismo grupo: las PQR radicadas
 * entre `from` y `to` (fechas en la zona horaria del conjunto), así los números cuadran entre sí.
 */
export interface PqrReport {
  from: string;
  to: string;
  /** PQR radicadas en el periodo. */
  received: number;
  /** De esas, cuántas están hoy por revisar o en trámite. */
  pending: number;
  /** De esas, cuántas están hoy resueltas o cerradas. */
  resolved: number;
  /** Horas promedio entre la radicación y la primera respuesta del personal. null si ninguna tiene respuesta. */
  avgFirstResponseHours: number | null;
  /** Horas promedio entre la radicación y la resolución. null si ninguna se ha resuelto. */
  avgResolutionHours: number | null;
  byStatus: { status: PqrStatus; count: number }[];
  byType: { type: PqrType; count: number }[];
  byCategory: CountByLabel[];
  byTower: CountByLabel[];
  /** Radicadas y resueltas por mes de radicación (AAAA-MM). */
  trend: { month: string; received: number; resolved: number }[];
}
