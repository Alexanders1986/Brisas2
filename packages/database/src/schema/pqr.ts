import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, timestamptz } from './_shared';
import { users } from './identity';
import { tenants } from './platform';
import { persons, properties } from './residential';

export const pqrType = pgEnum('pqr_type', ['petition', 'complaint', 'claim', 'suggestion']);
export const pqrStatus = pgEnum('pqr_status', ['pending_review', 'in_progress', 'resolved', 'closed']);
export const pqrPriority = pgEnum('pqr_priority', ['low', 'medium', 'high']);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** Consecutivo anual por conjunto para generar radicados (PQR-2026-000125) sin colisiones. */
export const pqrSequences = pgTable(
  'pqr_sequences',
  {
    tenantId: tenantRef(),
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

export const pqrs = pgTable(
  'pqrs',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    filingNumber: varchar('filing_number', { length: 20 }).notNull(),
    type: pqrType('type').notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    subject: varchar('subject', { length: 160 }).notNull(),
    description: text('description').notNull(),
    priority: pqrPriority('priority').notNull().default('medium'),
    status: pqrStatus('status').notNull().default('pending_review'),
    requesterUserId: uuid('requester_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requesterPersonId: uuid('requester_person_id'),
    propertyId: uuid('property_id'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    firstResponseAt: timestamptz('first_response_at'),
    resolvedAt: timestamptz('resolved_at'),
    closedAt: timestamptz('closed_at'),
    ...timestamps(),
  },
  (t) => [
    unique('pqrs_tenant_id_id_key').on(t.tenantId, t.id),
    unique('pqrs_tenant_filing_number_key').on(t.tenantId, t.filingNumber),
    foreignKey({
      name: 'pqrs_requester_person_fk',
      columns: [t.tenantId, t.requesterPersonId],
      foreignColumns: [persons.tenantId, persons.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pqrs_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    index('pqrs_tenant_status_idx').on(t.tenantId, t.status, t.createdAt.desc()),
    index('pqrs_tenant_requester_idx').on(t.tenantId, t.requesterUserId),
    index('pqrs_tenant_assignee_idx').on(t.tenantId, t.assigneeUserId),
    check('pqrs_filing_number_format', sql`${t.filingNumber} ~ '^PQR-[0-9]{4}-[0-9]{6}$'`),
  ],
);

/** Mensaje del hilo de una PQR. Los internos solo los ve el personal autorizado. */
export const pqrComments = pgTable(
  'pqr_comments',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    pqrId: uuid('pqr_id').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pqr_comments_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'pqr_comments_pqr_fk',
      columns: [t.tenantId, t.pqrId],
      foreignColumns: [pqrs.tenantId, pqrs.id],
    }).onDelete('cascade'),
    index('pqr_comments_pqr_idx').on(t.pqrId, t.createdAt),
  ],
);

/** Historial inmutable de cambios de estado: base de las métricas de tiempos de atención. */
export const pqrStatusHistory = pgTable(
  'pqr_status_history',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    pqrId: uuid('pqr_id').notNull(),
    fromStatus: pqrStatus('from_status'),
    toStatus: pqrStatus('to_status').notNull(),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    note: varchar('note', { length: 500 }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'pqr_status_history_pqr_fk',
      columns: [t.tenantId, t.pqrId],
      foreignColumns: [pqrs.tenantId, pqrs.id],
    }).onDelete('cascade'),
    index('pqr_status_history_pqr_idx').on(t.pqrId, t.createdAt),
  ],
);
