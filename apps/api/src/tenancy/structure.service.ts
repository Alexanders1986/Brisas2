import {
  type GeneratePropertiesResult,
  type Paginated,
  type PropertySummary,
  type TowerSummary,
  propertyLabel,
} from '@brisas/contracts';
import { plans, properties, tenants, towers } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { likePattern, paginate } from '../common/pagination';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { DatabaseService, type Tx } from '../database/database.service';
import type {
  GeneratePropertiesDto,
  ListPropertiesQueryDto,
  PropertyDto,
  TowerDto,
  UpdatePropertyDto,
} from './structure.dto';

// Las subconsultas correlacionadas nombran la tabla externa de forma explícita.
const activeOccupants = sql<number>`(
  SELECT count(*)::int FROM property_occupancies o
  WHERE o.property_id = "properties"."id" AND o.end_date IS NULL
)`;

const DUPLICATE_UNIT = () =>
  AppError.conflict('DUPLICATE_PROPERTY', 'Ya existe una unidad con ese número en esta torre.', {
    fields: { number: 'Este número ya está en uso' },
  });

@Injectable()
export class StructureService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- torres

  listTowers(tenant: TenantContext): Promise<TowerSummary[]> {
    return this.database.tenant(tenant, (tx) =>
      tx
        .select({
          id: towers.id,
          name: towers.name,
          kind: towers.kind,
          floors: towers.floors,
          unitsCount: sql<number>`(
            SELECT count(*)::int FROM properties p WHERE p.tower_id = "towers"."id" AND p.is_active
          )`,
        })
        .from(towers)
        .orderBy(asc(towers.sortOrder), asc(towers.name)),
    );
  }

  async createTower(tenant: TenantContext, input: TowerDto, meta: RequestMeta): Promise<TowerSummary> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        const [last] = await tx.select({ value: sql<number>`coalesce(max(${towers.sortOrder}), -1)::int` }).from(towers);
        const [tower] = await tx
          .insert(towers)
          .values({ tenantId: tenant.tenantId, ...input, sortOrder: (last?.value ?? -1) + 1 })
          .returning();
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'tower.created',
          entityType: 'tower',
          entityId: tower!.id,
          summary: `Creó ${tower!.name}`,
          meta,
        });
        return { id: tower!.id, name: tower!.name, kind: tower!.kind, floors: tower!.floors, unitsCount: 0 };
      });
    } catch (error) {
      throw this.towerConflict(error);
    }
  }

  async updateTower(tenant: TenantContext, towerId: string, input: TowerDto, meta: RequestMeta): Promise<void> {
    try {
      await this.database.tenant(tenant, async (tx) => {
        const [tower] = await tx.update(towers).set(input).where(eq(towers.id, towerId)).returning();
        if (!tower) throw AppError.notFound('No encontramos la torre.');
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'tower.updated',
          entityType: 'tower',
          entityId: towerId,
          summary: `Actualizó ${tower.name}`,
          meta,
        });
      });
    } catch (error) {
      throw this.towerConflict(error);
    }
  }

  async deleteTower(tenant: TenantContext, towerId: string, meta: RequestMeta): Promise<void> {
    await this.database.tenant(tenant, async (tx) => {
      const [units] = await tx.select({ value: count() }).from(properties).where(eq(properties.towerId, towerId));
      if ((units?.value ?? 0) > 0) {
        throw AppError.conflict(
          'TOWER_HAS_UNITS',
          'Esta torre tiene unidades registradas. Elimínalas o muévelas antes de borrar la torre.',
        );
      }
      const [tower] = await tx.delete(towers).where(eq(towers.id, towerId)).returning();
      if (!tower) throw AppError.notFound('No encontramos la torre.');
      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: 'tower.deleted',
        entityType: 'tower',
        entityId: towerId,
        summary: `Eliminó ${tower.name}`,
        meta,
      });
    });
  }

  // --------------------------------------------------------------- unidades

  async listProperties(tenant: TenantContext, query: ListPropertiesQueryDto): Promise<Paginated<PropertySummary>> {
    return this.database.tenant(tenant, async (tx) => {
      const where = and(
        query.includeInactive ? undefined : eq(properties.isActive, true),
        query.towerId ? eq(properties.towerId, query.towerId) : undefined,
        query.search ? ilike(properties.number, likePattern(query.search)) : undefined,
        query.occupancy === 'occupied' ? sql`${activeOccupants} > 0` : undefined,
        query.occupancy === 'vacant' ? sql`${activeOccupants} = 0` : undefined,
      );
      const [total] = await tx.select({ value: count() }).from(properties).where(where);
      const rows = await this.selectProperties(tx)
        .where(where)
        // Orden natural: torre, piso y número (102 antes que 1001).
        .orderBy(
          asc(towers.sortOrder),
          asc(towers.name),
          sql`${properties.floor} NULLS FIRST`,
          sql`length(${properties.number})`,
          asc(properties.number),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return paginate(rows.map(toPropertySummary), total?.value ?? 0, query.page, query.pageSize);
    });
  }

  async createProperty(tenant: TenantContext, input: PropertyDto, meta: RequestMeta): Promise<PropertySummary> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        await this.assertTowerExists(tx, input.towerId);
        await this.assertPlanCapacity(tx, tenant.tenantId, 1);
        const [property] = await tx
          .insert(properties)
          .values({ tenantId: tenant.tenantId, ...input, towerId: input.towerId ?? null })
          .returning({ id: properties.id });
        const summary = await this.findProperty(tx, property!.id);
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'property.created',
          entityType: 'property',
          entityId: summary.id,
          summary: `Creó la unidad ${summary.label}`,
          meta,
        });
        return summary;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw DUPLICATE_UNIT();
      throw error;
    }
  }

  async updateProperty(
    tenant: TenantContext,
    propertyId: string,
    input: UpdatePropertyDto,
    meta: RequestMeta,
  ): Promise<PropertySummary> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        const current = await this.findProperty(tx, propertyId);
        if (input.towerId) await this.assertTowerExists(tx, input.towerId);
        if (input.isActive === false && current.activeOccupants > 0) {
          throw AppError.conflict(
            'PROPERTY_OCCUPIED',
            'Esta unidad tiene residentes vinculados. Termina sus vinculaciones antes de desactivarla.',
          );
        }
        if (input.isActive === true && !current.isActive) await this.assertPlanCapacity(tx, tenant.tenantId, 1);
        await tx.update(properties).set(input).where(eq(properties.id, propertyId));
        const summary = await this.findProperty(tx, propertyId);
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'property.updated',
          entityType: 'property',
          entityId: propertyId,
          summary: `Actualizó la unidad ${summary.label}`,
          changes: { ...input },
          meta,
        });
        return summary;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw DUPLICATE_UNIT();
      throw error;
    }
  }

  /** Crea en bloque las unidades de una torre. Las que ya existen se omiten. */
  async generateProperties(
    tenant: TenantContext,
    input: GeneratePropertiesDto,
    meta: RequestMeta,
  ): Promise<GeneratePropertiesResult> {
    return this.database.tenant(tenant, async (tx) => {
      const [tower] = await tx.select().from(towers).where(eq(towers.id, input.towerId));
      if (!tower) throw AppError.notFound('No encontramos la torre.');

      const values = [];
      for (let floor = input.fromFloor; floor <= input.toFloor; floor += 1) {
        for (let unit = 1; unit <= input.unitsPerFloor; unit += 1) {
          values.push({
            tenantId: tenant.tenantId,
            towerId: tower.id,
            kind: input.kind,
            floor,
            number: `${floor}${String(unit).padStart(2, '0')}`,
          });
        }
      }
      const inserted = await tx.insert(properties).values(values).onConflictDoNothing().returning({ id: properties.id });
      // El límite del plan se revisa después de insertar: la transacción se revierte si se supera.
      await this.assertPlanCapacity(tx, tenant.tenantId, 0);
      if (tower.floors === null || tower.floors < input.toFloor) {
        await tx.update(towers).set({ floors: input.toFloor }).where(eq(towers.id, tower.id));
      }
      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: 'property.generated',
        entityType: 'tower',
        entityId: tower.id,
        summary: `Generó ${inserted.length} unidades en ${tower.name}`,
        changes: { ...input, created: inserted.length },
        meta,
      });
      return { created: inserted.length, skipped: values.length - inserted.length };
    });
  }

  // ---------------------------------------------------------------- internos

  private selectProperties(tx: Tx) {
    return tx
      .select({
        id: properties.id,
        towerId: properties.towerId,
        towerName: towers.name,
        kind: properties.kind,
        number: properties.number,
        floor: properties.floor,
        areaM2: properties.areaM2,
        isActive: properties.isActive,
        activeOccupants,
      })
      .from(properties)
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .$dynamic();
  }

  private async findProperty(tx: Tx, propertyId: string): Promise<PropertySummary> {
    const [row] = await this.selectProperties(tx).where(eq(properties.id, propertyId));
    if (!row) throw AppError.notFound('No encontramos la unidad.');
    return toPropertySummary(row);
  }

  private async assertTowerExists(tx: Tx, towerId: string | null | undefined): Promise<void> {
    if (!towerId) return;
    const [tower] = await tx.select({ id: towers.id }).from(towers).where(eq(towers.id, towerId));
    if (!tower) {
      throw AppError.unprocessable('TOWER_NOT_FOUND', 'La torre seleccionada no existe.', {
        fields: { towerId: 'Selecciona una torre válida' },
      });
    }
  }

  /** Verifica que el conjunto no supere las unidades que permite su plan. */
  private async assertPlanCapacity(tx: Tx, tenantId: string, adding: number): Promise<void> {
    const [plan] = await tx
      .select({ maxUnits: plans.maxUnits, name: plans.name })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, tenantId));
    if (!plan || plan.maxUnits === null) return;
    const [current] = await tx.select({ value: count() }).from(properties).where(eq(properties.isActive, true));
    if ((current?.value ?? 0) + adding > plan.maxUnits) {
      throw AppError.unprocessable(
        'PLAN_LIMIT_REACHED',
        `El plan ${plan.name} permite hasta ${plan.maxUnits} unidades. Comunícate con soporte para ampliarlo.`,
      );
    }
  }

  private towerConflict(error: unknown): unknown {
    if (!isUniqueViolation(error)) return error;
    return AppError.conflict('DUPLICATE_TOWER', 'Ya existe una torre o bloque con ese nombre.', {
      fields: { name: 'Este nombre ya está en uso' },
    });
  }
}

function toPropertySummary(row: Omit<PropertySummary, 'label'>): PropertySummary {
  return { ...row, label: propertyLabel(row.kind, row.number, row.towerName) };
}
