import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, timestamptz } from './_shared';
import { users } from './identity';
import { tenants } from './platform';

export const notificationChannel = pgEnum('notification_channel', ['email', 'push']);
export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sending', 'sent', 'failed', 'dead']);

/** Notificación dentro de la aplicación (campana) dirigida a un usuario. */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 60 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 500 }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_feed_idx').on(t.tenantId, t.userId, t.createdAt.desc())],
);

/** Plantilla de mensaje. tenant_id null = plantilla por defecto de la plataforma. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 60 }).notNull(),
    channel: notificationChannel('channel').notNull().default('email'),
    subject: varchar('subject', { length: 200 }).notNull(),
    bodyHtml: text('body_html').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique('notification_templates_tenant_key_channel_key').on(t.tenantId, t.key, t.channel).nullsNotDistinct()],
);

/**
 * Cola de envíos (patrón outbox). Se inserta en la misma transacción que el hecho de
 * negocio; un trabajador la procesa con reintentos y la clave de idempotencia impide
 * que un mismo evento genere dos correos.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    /** null para correos de cuenta que no pertenecen a un conjunto (recuperar contraseña). */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull().default('email'),
    templateKey: varchar('template_key', { length: 60 }).notNull(),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    payload: jsonb('payload').$type<Record<string, string>>().notNull().default({}),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    status: deliveryStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    lastError: varchar('last_error', { length: 1000 }),
    providerMessageId: varchar('provider_message_id', { length: 200 }),
    sentAt: timestamptz('sent_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_idempotency_key').on(t.idempotencyKey),
    index('notification_deliveries_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN ('queued', 'failed')`),
  ],
);
