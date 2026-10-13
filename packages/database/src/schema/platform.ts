import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './_shared';

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);

/** Planes de servicio que administra el SuperAdmin de la plataforma. */
export const plans = pgTable('plans', {
  id: primaryId(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  name: varchar('name', { length: 80 }).notNull(),
  /** Límite de unidades residenciales; null = sin límite. */
  maxUnits: integer('max_units'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/** Conjunto residencial. Es la raíz de aislamiento: todo dato privado cuelga de un tenant. */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 40 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    taxId: varchar('tax_id', { length: 30 }),
    status: tenantStatus('status').notNull().default('active'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    suspendedAt: timestamptz('suspended_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/** Personalización e información institucional editable desde el panel (relación 1:1 con tenants). */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Referencia a attachments.id (sin FK para evitar el ciclo tenants ↔ attachments). */
    logoAttachmentId: uuid('logo_attachment_id'),
    primaryColor: varchar('primary_color', { length: 7 }),
    secondaryColor: varchar('secondary_color', { length: 7 }),
    welcomeMessage: varchar('welcome_message', { length: 280 }),
    address: varchar('address', { length: 200 }),
    city: varchar('city', { length: 80 }),
    phones: jsonb('phones').$type<string[]>().notNull().default([]),
    whatsapp: varchar('whatsapp', { length: 20 }),
    email: varchar('email', { length: 254 }),
    website: varchar('website', { length: 200 }),
    officeHours: varchar('office_hours', { length: 500 }),
    /** Pasarela de pagos externa. Solo HTTPS (se valida también en la API). */
    paymentUrl: varchar('payment_url', { length: 500 }),
    timezone: varchar('timezone', { length: 60 }).notNull().default('America/Bogota'),
    privacyPolicyText: text('privacy_policy_text'),
    updatedBy: uuid('updated_by'),
    ...timestamps(),
  },
  (t) => [
    check('tenant_settings_primary_color_hex', sql`${t.primaryColor} IS NULL OR ${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`),
    check(
      'tenant_settings_secondary_color_hex',
      sql`${t.secondaryColor} IS NULL OR ${t.secondaryColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    check('tenant_settings_payment_url_https', sql`${t.paymentUrl} IS NULL OR ${t.paymentUrl} LIKE 'https://%'`),
  ],
);
