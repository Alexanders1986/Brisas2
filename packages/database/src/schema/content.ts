import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
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
import { attachments } from './files';
import { users } from './identity';
import { tenants } from './platform';
import { properties, towers } from './residential';

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

// ------------------------------------------------------------ documentos

export const documentStatus = pgEnum('document_status', ['active', 'archived']);

export const documentCategories = pgTable(
  'document_categories',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    name: varchar('name', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Categorías sugeridas al crear el conjunto (reglamento, manual de convivencia…). */
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique('document_categories_tenant_id_id_key').on(t.tenantId, t.id),
    uniqueIndex('document_categories_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`),
  ],
);

export const institutionalDocuments = pgTable(
  'institutional_documents',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    categoryId: uuid('category_id').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    description: varchar('description', { length: 500 }),
    /** Versión vigente (document_versions.id). */
    currentVersionId: uuid('current_version_id'),
    /** Claves de rol que pueden verlo; arreglo vacío = todos los miembros del conjunto. */
    visibleToRoles: jsonb('visible_to_roles').$type<string[]>().notNull().default([]),
    status: documentStatus('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamptz('deleted_at'),
    ...timestamps(),
  },
  (t) => [
    unique('institutional_documents_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'institutional_documents_category_fk',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [documentCategories.tenantId, documentCategories.id],
    }).onDelete('restrict'),
    index('institutional_documents_tenant_category_idx').on(t.tenantId, t.categoryId, t.status),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    documentId: uuid('document_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    attachmentId: uuid('attachment_id').notNull(),
    changeNote: varchar('change_note', { length: 300 }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('document_versions_document_version_key').on(t.documentId, t.versionNumber),
    foreignKey({
      name: 'document_versions_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [institutionalDocuments.tenantId, institutionalDocuments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'document_versions_attachment_fk',
      columns: [t.tenantId, t.attachmentId],
      foreignColumns: [attachments.tenantId, attachments.id],
    }).onDelete('restrict'),
    check('document_versions_number_positive', sql`${t.versionNumber} >= 1`),
  ],
);

// ----------------------------------------------------------- comunicados

export const announcementStatus = pgEnum('announcement_status', ['draft', 'scheduled', 'published', 'archived']);
export const audienceType = pgEnum('audience_type', ['all', 'role', 'tower', 'property']);

export const announcements = pgTable(
  'announcements',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    title: varchar('title', { length: 160 }).notNull(),
    /** HTML ya sanitizado en el servidor con una lista blanca de etiquetas. */
    bodyHtml: text('body_html').notNull(),
    excerpt: varchar('excerpt', { length: 300 }),
    coverAttachmentId: uuid('cover_attachment_id'),
    status: announcementStatus('status').notNull().default('draft'),
    /** Fecha programada de publicación. */
    publishAt: timestamptz('publish_at'),
    publishedAt: timestamptz('published_at'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isUrgent: boolean('is_urgent').notNull().default(false),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('announcements_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'announcements_cover_fk',
      columns: [t.tenantId, t.coverAttachmentId],
      foreignColumns: [attachments.tenantId, attachments.id],
    }).onDelete('restrict'),
    index('announcements_tenant_feed_idx').on(t.tenantId, t.status, t.publishedAt.desc()),
  ],
);

/** Destinatarios de un comunicado. Sin filas o con una fila "all" = todo el conjunto. */
export const announcementAudiences = pgTable(
  'announcement_audiences',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    announcementId: uuid('announcement_id').notNull(),
    audienceType: audienceType('audience_type').notNull(),
    roleKey: varchar('role_key', { length: 60 }),
    towerId: uuid('tower_id'),
    propertyId: uuid('property_id'),
  },
  (t) => [
    foreignKey({
      name: 'announcement_audiences_announcement_fk',
      columns: [t.tenantId, t.announcementId],
      foreignColumns: [announcements.tenantId, announcements.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'announcement_audiences_tower_fk',
      columns: [t.tenantId, t.towerId],
      foreignColumns: [towers.tenantId, towers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'announcement_audiences_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('cascade'),
    index('announcement_audiences_announcement_idx').on(t.announcementId),
    // El destino debe corresponder con el tipo de audiencia.
    check(
      'announcement_audiences_target',
      sql`(${t.audienceType} = 'all' AND ${t.roleKey} IS NULL AND ${t.towerId} IS NULL AND ${t.propertyId} IS NULL)
        OR (${t.audienceType} = 'role' AND ${t.roleKey} IS NOT NULL AND ${t.towerId} IS NULL AND ${t.propertyId} IS NULL)
        OR (${t.audienceType} = 'tower' AND ${t.towerId} IS NOT NULL AND ${t.roleKey} IS NULL AND ${t.propertyId} IS NULL)
        OR (${t.audienceType} = 'property' AND ${t.propertyId} IS NOT NULL AND ${t.roleKey} IS NULL AND ${t.towerId} IS NULL)`,
    ),
  ],
);
