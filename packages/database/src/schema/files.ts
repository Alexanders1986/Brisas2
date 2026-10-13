import { sql } from 'drizzle-orm';
import { bigint, check, index, pgEnum, pgTable, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz } from './_shared';
import { users } from './identity';
import { tenants } from './platform';

export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready', 'quarantined']);

export const attachmentOwnerType = pgEnum('attachment_owner_type', [
  'tenant_logo',
  'document_version',
  'announcement',
  'project',
  'project_update',
  'pqr',
  'pqr_comment',
  'occupancy',
]);

/**
 * Metadatos de un archivo guardado en almacenamiento privado. El binario vive en
 * el bucket bajo `tenants/<tenant_id>/…` y solo se entrega mediante URL firmada
 * de corta duración después de autorizar al usuario sobre el recurso dueño.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ownerType: attachmentOwnerType('owner_type').notNull(),
    /** Id del recurso dueño; null mientras la carga no se ha asociado. */
    ownerId: uuid('owner_id'),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    status: attachmentStatus('status').notNull().default('pending'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    unique('attachments_tenant_id_id_key').on(t.tenantId, t.id),
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    index('attachments_owner_idx').on(t.tenantId, t.ownerType, t.ownerId),
    check('attachments_size_positive', sql`${t.sizeBytes} > 0`),
    // La clave de almacenamiento siempre queda dentro del prefijo del conjunto.
    check('attachments_storage_key_prefix', sql`${t.storageKey} LIKE 'tenants/' || ${t.tenantId}::text || '/%'`),
  ],
);
