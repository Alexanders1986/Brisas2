import type { Paginated, PlanSummary, PlatformMetrics, TenantSummary } from '@brisas/contracts';
import { documentCategories, plans, tenantSettings, tenants, users } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../auth/identity.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { likePattern, paginate } from '../common/pagination';
import type { AuthContext, RequestMeta } from '../common/request-context';
import { DatabaseService, type Tx } from '../database/database.service';
import type { CreateTenantDto, ListTenantsQueryDto, UpdateTenantDto } from './platform.dto';

/** Categorías con las que nace la biblioteca documental de cada conjunto. */
const DEFAULT_DOCUMENT_CATEGORIES = [
  'Reglamento de Propiedad Horizontal',
  'Reglamento Interno de Copropiedad (RIC)',
  'Manual de Convivencia',
  'Protocolos de mudanza',
  'Circulares',
  'Formatos',
  'Otros documentos',
];

const unitsCount = sql<number>`(
  SELECT count(*)::int FROM properties p WHERE p.tenant_id = "tenants"."id" AND p.is_active
)`;
const activeResidentsCount = sql<number>`(
  SELECT count(DISTINCT o.person_id)::int FROM property_occupancies o
  WHERE o.tenant_id = "tenants"."id" AND o.end_date IS NULL
)`;

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, query: ListTenantsQueryDto): Promise<Paginated<TenantSummary>> {
    return this.database.platform(auth.userId, async (tx) => {
      const pattern = query.search ? likePattern(query.search) : undefined;
      const where = and(
        query.status ? eq(tenants.status, query.status) : undefined,
        pattern ? or(ilike(tenants.name, pattern), ilike(tenants.slug, pattern), ilike(tenants.taxId, pattern)) : undefined,
      );
      const [total] = await tx.select({ value: count() }).from(tenants).where(where);
      const rows = await this.selectSummaries(tx)
        .where(where)
        .orderBy(desc(tenants.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return paginate(rows.map(toSummary), total?.value ?? 0, query.page, query.pageSize);
    });
  }

  async get(auth: AuthContext, tenantId: string): Promise<TenantSummary> {
    return this.database.platform(auth.userId, (tx) => this.findSummary(tx, tenantId));
  }

  async create(auth: AuthContext, input: CreateTenantDto, meta: RequestMeta): Promise<TenantSummary> {
    try {
      return await this.database.platform(auth.userId, async (tx) => {
        const plan = await this.findPlan(tx, input.planKey);
        const [tenant] = await tx
          .insert(tenants)
          .values({ slug: input.slug, name: input.name, taxId: input.taxId, planId: plan.id })
          .returning();
        await tx.insert(tenantSettings).values({
          tenantId: tenant!.id,
          address: input.address,
          city: input.city,
          updatedBy: auth.userId,
        });
        await tx.insert(documentCategories).values(
          DEFAULT_DOCUMENT_CATEGORIES.map((name, sortOrder) => ({
            tenantId: tenant!.id,
            name,
            sortOrder,
            isDefault: true,
          })),
        );

        // Primer administrador: se le asigna el rol y, si aún no tiene contraseña, se le invita.
        const { user } = await this.identity.ensureUser(tx, {
          email: input.admin.email,
          displayName: `${input.admin.firstName} ${input.admin.lastName}`,
        });
        if (user.status === 'disabled') {
          throw AppError.unprocessable('ADMIN_ACCOUNT_DISABLED', 'La cuenta de ese correo está desactivada.', {
            fields: { 'admin.email': 'Esta cuenta está desactivada' },
          });
        }
        await this.identity.ensureMembership(tx, {
          tenantId: tenant!.id,
          userId: user.id,
          roleKey: 'tenant_admin',
          createdBy: auth.userId,
        });
        if (user.status === 'invited') {
          await this.identity.issueInvitation(tx, { user, tenantId: tenant!.id, brandName: tenant!.name });
        }

        await this.audit.record(tx, {
          tenantId: tenant!.id,
          actorUserId: auth.userId,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenant!.id,
          summary: `Creó el conjunto ${tenant!.name} con administrador ${user.email}`,
          changes: { slug: tenant!.slug, plan: plan.key, adminEmail: user.email },
          meta,
        });
        return this.findSummary(tx, tenant!.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('SLUG_TAKEN', 'Ya existe un conjunto con ese identificador.', {
          fields: { slug: 'Este identificador ya está en uso' },
        });
      }
      throw error;
    }
  }

  async update(auth: AuthContext, tenantId: string, input: UpdateTenantDto, meta: RequestMeta): Promise<TenantSummary> {
    return this.database.platform(auth.userId, async (tx) => {
      await this.findSummary(tx, tenantId);
      const plan = input.planKey ? await this.findPlan(tx, input.planKey) : undefined;
      await tx
        .update(tenants)
        .set({ name: input.name, taxId: input.taxId, planId: plan?.id })
        .where(eq(tenants.id, tenantId));
      await this.audit.record(tx, {
        tenantId,
        actorUserId: auth.userId,
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: tenantId,
        summary: 'Actualizó los datos del conjunto',
        changes: { ...input },
        meta,
      });
      return this.findSummary(tx, tenantId);
    });
  }

  async setStatus(
    auth: AuthContext,
    tenantId: string,
    status: 'active' | 'suspended',
    meta: RequestMeta,
  ): Promise<TenantSummary> {
    return this.database.platform(auth.userId, async (tx) => {
      const current = await this.findSummary(tx, tenantId);
      if (current.status === status) return current;
      await tx
        .update(tenants)
        .set({ status, suspendedAt: status === 'suspended' ? new Date() : null })
        .where(eq(tenants.id, tenantId));
      await this.audit.record(tx, {
        tenantId,
        actorUserId: auth.userId,
        action: status === 'suspended' ? 'tenant.suspended' : 'tenant.activated',
        entityType: 'tenant',
        entityId: tenantId,
        summary: status === 'suspended' ? 'Desactivó el conjunto' : 'Activó el conjunto',
        meta,
      });
      return this.findSummary(tx, tenantId);
    });
  }

  async metrics(auth: AuthContext): Promise<PlatformMetrics> {
    return this.database.platform(auth.userId, async (tx) => {
      const [tenantCounts] = await tx
        .select({
          active: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'active')::int`,
          suspended: sql<number>`count(*) FILTER (WHERE ${tenants.status} = 'suspended')::int`,
        })
        .from(tenants);
      const [units] = await tx.execute<{ value: number }>(
        sql`SELECT count(*)::int AS value FROM properties WHERE is_active`,
      ).then((result) => result.rows);
      const [activeUsers] = await tx.select({ value: count() }).from(users).where(eq(users.status, 'active'));
      return {
        tenantsActive: tenantCounts?.active ?? 0,
        tenantsSuspended: tenantCounts?.suspended ?? 0,
        unitsTotal: units?.value ?? 0,
        usersActive: activeUsers?.value ?? 0,
      };
    });
  }

  async plans(auth: AuthContext): Promise<PlanSummary[]> {
    return this.database.platform(auth.userId, (tx) =>
      tx
        .select({ key: plans.key, name: plans.name, maxUnits: plans.maxUnits })
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(sql`${plans.maxUnits} NULLS LAST`),
    );
  }

  // ---------------------------------------------------------------- internos

  private selectSummaries(tx: Tx) {
    return tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        taxId: tenants.taxId,
        status: tenants.status,
        planKey: plans.key,
        planName: plans.name,
        city: tenantSettings.city,
        unitsCount,
        activeResidentsCount,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
      .$dynamic();
  }

  private async findSummary(tx: Tx, tenantId: string): Promise<TenantSummary> {
    const [row] = await this.selectSummaries(tx).where(eq(tenants.id, tenantId));
    if (!row) throw AppError.notFound('No encontramos el conjunto.');
    return toSummary(row);
  }

  private async findPlan(tx: Tx, key: string) {
    const [plan] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.key, key), eq(plans.isActive, true)));
    if (!plan) {
      throw AppError.unprocessable('PLAN_NOT_FOUND', 'El plan seleccionado no existe.', {
        fields: { planKey: 'Selecciona un plan válido' },
      });
    }
    return plan;
  }
}

function toSummary(row: Omit<TenantSummary, 'createdAt'> & { createdAt: Date }): TenantSummary {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
