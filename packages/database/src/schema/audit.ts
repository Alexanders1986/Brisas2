import { index, inet, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared';
import { users } from './identity';
import { tenants } from './platform';

/**
 * Bitácora de auditoría. Es de solo inserción: el rol de la aplicación no tiene
 * permiso de UPDATE ni DELETE sobre esta tabla (ver migración de seguridad).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    /** null para eventos de plataforma o de cuenta (inicio de sesión, cambio de contraseña). */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Verbo en formato entidad.acción, p. ej. resident.created. */
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: uuid('entity_id'),
    /** Resumen legible en español para mostrar en el historial. */
    summary: varchar('summary', { length: 500 }).notNull(),
    /** Detalle estructurado del cambio. Nunca incluye contraseñas, tokens ni secretos. */
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: varchar('user_agent', { length: 400 }),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.createdAt.desc()),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt.desc()),
  ],
);
