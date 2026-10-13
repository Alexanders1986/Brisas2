import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, timestamptz } from './_shared';
import { users } from './identity';
import { tenants } from './platform';

export const projectStatus = pgEnum('project_status', ['planned', 'in_progress', 'completed', 'suspended']);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const maintenanceProjects = pgTable(
  'maintenance_projects',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 80 }),
    /** Responsable visible para residentes (puede ser un contratista externo). */
    responsibleName: varchar('responsible_name', { length: 160 }),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id, { onDelete: 'set null' }),
    startDate: date('start_date', { mode: 'string' }),
    estimatedEndDate: date('estimated_end_date', { mode: 'string' }),
    actualEndDate: date('actual_end_date', { mode: 'string' }),
    status: projectStatus('status').notNull().default('planned'),
    progressPercent: integer('progress_percent').notNull().default(0),
    observations: text('observations'),
    /** Solo los proyectos publicados son visibles en el portal de residentes. */
    isPublished: boolean('is_published').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('maintenance_projects_tenant_id_id_key').on(t.tenantId, t.id),
    index('maintenance_projects_tenant_status_idx').on(t.tenantId, t.status),
    check('maintenance_projects_progress_range', sql`${t.progressPercent} BETWEEN 0 AND 100`),
    check(
      'maintenance_projects_dates',
      sql`${t.estimatedEndDate} IS NULL OR ${t.startDate} IS NULL OR ${t.estimatedEndDate} >= ${t.startDate}`,
    ),
  ],
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    projectId: uuid('project_id').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    completedAt: timestamptz('completed_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'project_milestones_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [maintenanceProjects.tenantId, maintenanceProjects.id],
    }).onDelete('cascade'),
    index('project_milestones_project_idx').on(t.projectId, t.sortOrder),
  ],
);

/** Avance registrado sobre un proyecto. Conserva el historial de estado y porcentaje. */
export const projectUpdates = pgTable(
  'project_updates',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    projectId: uuid('project_id').notNull(),
    body: text('body').notNull(),
    progressPercent: integer('progress_percent'),
    status: projectStatus('status'),
    /** Las actualizaciones no públicas solo las ve el personal del conjunto. */
    isPublic: boolean('is_public').notNull().default(true),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('project_updates_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'project_updates_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [maintenanceProjects.tenantId, maintenanceProjects.id],
    }).onDelete('cascade'),
    index('project_updates_project_idx').on(t.projectId, t.createdAt.desc()),
    check(
      'project_updates_progress_range',
      sql`${t.progressPercent} IS NULL OR ${t.progressPercent} BETWEEN 0 AND 100`,
    ),
  ],
);
