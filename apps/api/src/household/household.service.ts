import {
  type HouseholdMember,
  type HouseholdPet,
  type MyHouseholdResponse,
  type PropertyHousehold,
  VEHICLE_KIND_LABELS,
  type Vehicle,
  propertyLabel,
} from '@brisas/contracts';
import { householdMembers, persons, pets, properties, propertyOccupancies, towers, vehicles } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError, isUniqueViolation } from '../common/errors';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { DatabaseService, type Tx } from '../database/database.service';
import type { HouseholdMemberDto, HouseholdPetDto, VehicleDto } from './household.dto';

/**
 * Personas y vehículos de una unidad. Lo administran los propios residentes de la unidad
 * (permiso household.manage_own) y el personal con residents.manage.
 */
@Injectable()
export class HouseholdService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Las unidades donde el usuario autenticado tiene una vinculación vigente. */
  async mine(tenant: TenantContext): Promise<MyHouseholdResponse> {
    return this.database.tenant(tenant, async (tx) => {
      const rows = await tx
        .selectDistinct({ propertyId: propertyOccupancies.propertyId })
        .from(propertyOccupancies)
        .innerJoin(persons, eq(persons.id, propertyOccupancies.personId))
        .where(and(eq(persons.userId, tenant.userId), isNull(persons.deletedAt), isNull(propertyOccupancies.endDate)));
      const units: PropertyHousehold[] = [];
      for (const row of rows) units.push(await this.load(tx, tenant, row.propertyId));
      return { units };
    });
  }

  async get(tenant: TenantContext, propertyId: string): Promise<PropertyHousehold> {
    return this.database.tenant(tenant, async (tx) => {
      const household = await this.load(tx, tenant, propertyId);
      if (!household.canManage && !tenant.permissions.has('residents.read')) throw AppError.forbidden();
      return household;
    });
  }

  // ---------------------------------------------------------------- personas

  async addMember(tenant: TenantContext, propertyId: string, input: HouseholdMemberDto, meta: RequestMeta): Promise<HouseholdMember> {
    return this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [member] = await tx
        .insert(householdMembers)
        .values({ tenantId: tenant.tenantId, propertyId, ...input, createdBy: tenant.userId })
        .returning();
      await this.record(tx, tenant, propertyId, 'household.member_added', `Agregó a ${input.firstName} ${input.lastName} al hogar de ${label}`, meta);
      return toMember(member!);
    });
  }

  async updateMember(
    tenant: TenantContext,
    propertyId: string,
    memberId: string,
    input: HouseholdMemberDto,
    meta: RequestMeta,
  ): Promise<HouseholdMember> {
    return this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [member] = await tx
        .update(householdMembers)
        .set({ ...input, phone: input.phone ?? null, email: input.email ?? null })
        // El filtro por unidad impide editar a alguien de otra unidad con un id adivinado.
        .where(and(eq(householdMembers.id, memberId), eq(householdMembers.propertyId, propertyId)))
        .returning();
      if (!member) throw AppError.notFound('No encontramos a esta persona.');
      await this.record(tx, tenant, propertyId, 'household.member_updated', `Actualizó los datos de ${member.firstName} ${member.lastName} en ${label}`, meta);
      return toMember(member);
    });
  }

  async removeMember(tenant: TenantContext, propertyId: string, memberId: string, meta: RequestMeta): Promise<void> {
    await this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [member] = await tx
        .delete(householdMembers)
        .where(and(eq(householdMembers.id, memberId), eq(householdMembers.propertyId, propertyId)))
        .returning();
      if (!member) throw AppError.notFound('No encontramos a esta persona.');
      await this.record(tx, tenant, propertyId, 'household.member_removed', `Quitó a ${member.firstName} ${member.lastName} del hogar de ${label}`, meta);
    });
  }

  // --------------------------------------------------------------- vehículos

  async addVehicle(tenant: TenantContext, propertyId: string, input: VehicleDto, meta: RequestMeta): Promise<Vehicle> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        const label = await this.assertCanManage(tx, tenant, propertyId);
        const [vehicle] = await tx
          .insert(vehicles)
          .values({ tenantId: tenant.tenantId, propertyId, ...input, createdBy: tenant.userId })
          .returning();
        await this.record(tx, tenant, propertyId, 'household.vehicle_added', `Registró ${describe(vehicle!)} en ${label}`, meta);
        return toVehicle(vehicle!);
      });
    } catch (error) {
      throw plateConflict(error);
    }
  }

  async updateVehicle(
    tenant: TenantContext,
    propertyId: string,
    vehicleId: string,
    input: VehicleDto,
    meta: RequestMeta,
  ): Promise<Vehicle> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        const label = await this.assertCanManage(tx, tenant, propertyId);
        const [vehicle] = await tx
          .update(vehicles)
          .set({
            ...input,
            plate: input.plate ?? null,
            brand: input.brand ?? null,
            model: input.model ?? null,
            modelYear: input.modelYear ?? null,
            notes: input.notes ?? null,
          })
          .where(and(eq(vehicles.id, vehicleId), eq(vehicles.propertyId, propertyId)))
          .returning();
        if (!vehicle) throw AppError.notFound('No encontramos este vehículo.');
        await this.record(tx, tenant, propertyId, 'household.vehicle_updated', `Actualizó ${describe(vehicle)} en ${label}`, meta);
        return toVehicle(vehicle);
      });
    } catch (error) {
      throw plateConflict(error);
    }
  }

  async removeVehicle(tenant: TenantContext, propertyId: string, vehicleId: string, meta: RequestMeta): Promise<void> {
    await this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [vehicle] = await tx
        .delete(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.propertyId, propertyId)))
        .returning();
      if (!vehicle) throw AppError.notFound('No encontramos este vehículo.');
      await this.record(tx, tenant, propertyId, 'household.vehicle_removed', `Quitó ${describe(vehicle)} de ${label}`, meta);
    });
  }

  // ---------------------------------------------------------------- mascotas

  async addPet(tenant: TenantContext, propertyId: string, input: HouseholdPetDto, meta: RequestMeta): Promise<HouseholdPet> {
    return this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [pet] = await tx
        .insert(pets)
        .values({ tenantId: tenant.tenantId, propertyId, ...input })
        .returning();
      await this.record(tx, tenant, propertyId, 'household.pet_added', `Registró a la mascota ${input.name} en ${label}`, meta);
      return toPet(pet!);
    });
  }

  async updatePet(
    tenant: TenantContext,
    propertyId: string,
    petId: string,
    input: HouseholdPetDto,
    meta: RequestMeta,
  ): Promise<HouseholdPet> {
    return this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [pet] = await tx
        .update(pets)
        .set({ ...input, breed: input.breed ?? null, sex: input.sex ?? null, color: input.color ?? null })
        .where(and(eq(pets.id, petId), eq(pets.propertyId, propertyId), eq(pets.isActive, true)))
        .returning();
      if (!pet) throw AppError.notFound('No encontramos esta mascota.');
      await this.record(tx, tenant, propertyId, 'household.pet_updated', `Actualizó los datos de la mascota ${input.name} en ${label}`, meta);
      return toPet(pet);
    });
  }

  async removePet(tenant: TenantContext, propertyId: string, petId: string, meta: RequestMeta): Promise<void> {
    await this.database.tenant(tenant, async (tx) => {
      const label = await this.assertCanManage(tx, tenant, propertyId);
      const [pet] = await tx
        .delete(pets)
        .where(and(eq(pets.id, petId), eq(pets.propertyId, propertyId)))
        .returning();
      if (!pet) throw AppError.notFound('No encontramos esta mascota.');
      await this.record(tx, tenant, propertyId, 'household.pet_removed', `Quitó a la mascota ${pet.name ?? 'sin nombre'} de ${label}`, meta);
    });
  }

  // ---------------------------------------------------------------- internos

  private async load(tx: Tx, tenant: TenantContext, propertyId: string): Promise<PropertyHousehold> {
    const [property] = await tx
      .select({ kind: properties.kind, number: properties.number, towerName: towers.name })
      .from(properties)
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .where(eq(properties.id, propertyId));
    if (!property) throw AppError.notFound('No encontramos la unidad.');

    const residents = await tx
      .select({
        personId: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        relationship: propertyOccupancies.relationship,
        userId: persons.userId,
      })
      .from(propertyOccupancies)
      .innerJoin(persons, eq(persons.id, propertyOccupancies.personId))
      .where(and(eq(propertyOccupancies.propertyId, propertyId), isNull(propertyOccupancies.endDate)))
      .orderBy(asc(propertyOccupancies.startDate));

    const livesHere = residents.some((resident) => resident.userId === tenant.userId);
    const canManage =
      tenant.permissions.has('residents.manage') || (livesHere && tenant.permissions.has('household.manage_own'));
    // Quien no vive en la unidad ni es personal autorizado no recibe ningún dato de ella.
    if (!canManage && !tenant.permissions.has('residents.read')) throw AppError.notFound('No encontramos la unidad.');

    const members = await tx
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.propertyId, propertyId))
      .orderBy(asc(householdMembers.birthDate));
    const vehicleRows = await tx.select().from(vehicles).where(eq(vehicles.propertyId, propertyId)).orderBy(asc(vehicles.createdAt));

    const petRows = await tx
      .select()
      .from(pets)
      .where(and(eq(pets.propertyId, propertyId), eq(pets.isActive, true)))
      .orderBy(asc(pets.createdAt));

    return {
      propertyId,
      propertyLabel: propertyLabel(property.kind, property.number, property.towerName),
      residents: residents.map((resident) => ({
        personId: resident.personId,
        fullName: `${resident.firstName} ${resident.lastName}`,
        relationship: resident.relationship,
      })),
      members: members.map(toMember),
      vehicles: vehicleRows.map(toVehicle),
      pets: petRows.map(toPet),
      canManage,
    };
  }

  private async assertCanManage(tx: Tx, tenant: TenantContext, propertyId: string): Promise<string> {
    const household = await this.load(tx, tenant, propertyId);
    if (!household.canManage) throw AppError.forbidden();
    return household.propertyLabel;
  }

  private record(tx: Tx, tenant: TenantContext, propertyId: string, action: string, summary: string, meta: RequestMeta) {
    return this.audit.record(tx, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      action,
      entityType: 'property',
      entityId: propertyId,
      summary,
      meta,
    });
  }
}

function toMember(row: typeof householdMembers.$inferSelect): HouseholdMember {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    kinship: row.kinship,
    gender: row.gender,
    birthDate: row.birthDate,
    phone: row.phone,
    email: row.email,
    receivesNotifications: row.receivesNotifications,
  };
}

function toPet(row: typeof pets.$inferSelect): HouseholdPet {
  return {
    id: row.id,
    species: row.species,
    name: row.name,
    breed: row.breed,
    sex: row.sex,
    color: row.color,
    vaccinesUpToDate: row.vaccinesUpToDate,
  };
}

function toVehicle(row: typeof vehicles.$inferSelect): Vehicle {
  return {
    id: row.id,
    kind: row.kind,
    powertrain: row.powertrain,
    plate: row.plate,
    brand: row.brand,
    model: row.model,
    modelYear: row.modelYear,
    color: row.color,
    notes: row.notes,
  };
}

function describe(vehicle: typeof vehicles.$inferSelect): string {
  const kind = VEHICLE_KIND_LABELS[vehicle.kind].toLowerCase();
  return vehicle.plate ? `el vehículo ${vehicle.plate} (${kind})` : `un vehículo (${kind}, ${vehicle.color.toLowerCase()})`;
}

function plateConflict(error: unknown): unknown {
  if (!isUniqueViolation(error)) return error;
  return AppError.conflict('PLATE_TAKEN', 'Esa placa ya está registrada en otra unidad del conjunto.', {
    fields: { plate: 'Esta placa ya está registrada' },
  });
}
