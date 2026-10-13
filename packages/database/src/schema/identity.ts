import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, timestamptz } from './_shared';
import { tenants } from './platform';

export const userStatus = pgEnum('user_status', ['invited', 'active', 'disabled']);
export const membershipStatus = pgEnum('membership_status', ['active', 'suspended']);
export const authTokenPurpose = pgEnum('auth_token_purpose', ['password_reset', 'invitation']);
export const clientType = pgEnum('client_type', ['web', 'mobile']);

/**
 * Cuenta de acceso. Es global a la plataforma: una misma cuenta puede pertenecer
 * a varios conjuntos con roles distintos (ver user_tenant_memberships).
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: varchar('email', { length: 254 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    /** null mientras la invitación no ha sido aceptada. Hash Argon2id. */
    passwordHash: text('password_hash'),
    status: userStatus('status').notNull().default('invited'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    /** Secreto TOTP cifrado con AES-256-GCM (DATA_ENCRYPTION_KEY). */
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    /** Hashes SHA-256 de los códigos de recuperación aún no usados. */
    mfaRecoveryCodeHashes: jsonb('mfa_recovery_code_hashes').$type<string[]>().notNull().default([]),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    lastLoginAt: timestamptz('last_login_at'),
    passwordChangedAt: timestamptz('password_changed_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

/** Sesión por dispositivo. El refresh token rota en cada uso y solo se guarda su hash. */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    /** Hash del token anterior: si reaparece, hubo robo o reuso y la sesión se revoca. */
    previousTokenHash: varchar('previous_token_hash', { length: 64 }),
    client: clientType('client').notNull().default('web'),
    userAgent: varchar('user_agent', { length: 400 }),
    ip: inet('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 40 }),
  },
  (t) => [
    uniqueIndex('user_sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    index('user_sessions_previous_token_hash_idx').on(t.previousTokenHash),
    index('user_sessions_user_active_idx').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
  ],
);

/** Tokens de un solo uso para recuperar contraseña y aceptar invitaciones. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Conjunto que originó la invitación (para personalizar la pantalla de bienvenida). */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_token_hash_key').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId)],
);

/** Rol. tenant_id null = rol del sistema disponible para todos los conjuntos. */
export const roles = pgTable(
  'roles',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 300 }),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique('roles_tenant_key_key').on(t.tenantId, t.key).nullsNotDistinct()],
);

/** Catálogo global de permisos. La clave coincide con PERMISSIONS de @brisas/contracts. */
export const permissions = pgTable('permissions', {
  key: varchar('key', { length: 60 }).primaryKey(),
  description: varchar('description', { length: 300 }).notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 60 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/**
 * Pertenencia de un usuario a un conjunto con un rol. Un usuario puede tener varias
 * filas por conjunto (p. ej. propietario y miembro del consejo): sus permisos se unen.
 */
export const userTenantMemberships = pgTable(
  'user_tenant_memberships',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: membershipStatus('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('user_tenant_memberships_user_tenant_role_key').on(t.userId, t.tenantId, t.roleId),
    index('user_tenant_memberships_tenant_idx').on(t.tenantId),
  ],
);

/** Consentimientos de tratamiento de datos (Ley 1581 de 2012): prueba de la autorización. */
export const consents = pgTable(
  'consents',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 40 }).notNull(),
    policyVersion: varchar('policy_version', { length: 20 }).notNull(),
    acceptedAt: timestamptz('accepted_at').notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: varchar('user_agent', { length: 400 }),
  },
  (t) => [index('consents_user_idx').on(t.userId)],
);

export const dataSubjectRequestType = pgEnum('data_subject_request_type', [
  'access',
  'rectification',
  'deletion',
  'revocation',
]);
export const dataSubjectRequestStatus = pgEnum('data_subject_request_status', [
  'received',
  'in_progress',
  'completed',
  'rejected',
]);

/** Solicitudes de titulares (consulta, corrección, supresión, revocatoria) con trazabilidad de plazos. */
export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requesterUserId: uuid('requester_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: dataSubjectRequestType('type').notNull(),
    status: dataSubjectRequestStatus('status').notNull().default('received'),
    details: text('details').notNull(),
    resolution: text('resolution'),
    dueAt: timestamptz('due_at').notNull(),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('data_subject_requests_tenant_status_idx').on(t.tenantId, t.status)],
);
