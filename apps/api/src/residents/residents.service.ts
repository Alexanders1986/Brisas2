import {
  type AccessStatus,
  type CreateResidentResponse,
  type DocumentType,
  type DuplicateMatch,
  type OccupancySummary,
  type Paginated,
  RELATIONSHIP_LABELS,
  RELATIONSHIP_ROLE,
  type RelationshipType,
  type ResidentDetail,
  type ResidentListItem,
  propertyLabel,
} from '@brisas/contracts';
import {
  auditLogs,
  parkingSpaces,
  persons,
  pets,
  properties,
  propertyOccupancies,
  storageUnits,
  tenants,
  towers,
  users,
} from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { type SQL, and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../auth/identity.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { likePattern, paginate } from '../common/pagination';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { DatabaseService, type Tx } from '../database/database.service';
import type {
  CheckDuplicateQueryDto,
  CreateResidentDto,
  ListResidentsQueryDto,
  UpdateResidentDto,
} from './residents.dto';

type Person = typeof persons.$inferSelect;

// Las subconsultas correlacionadas nombran la tabla externa de forma explícita.
const HAS_ACTIVE_OCCUPANCY = sql<boolean>`EXISTS (
  SELECT 1 FROM property_occupancies o WHERE o.person_id = "persons"."id" AND o.end_date IS NULL
)`;
const HAS_ACTIVE_MEMBERSHIP = sql<boolean>`EXISTS (
  SELECT 1 FROM user_tenant_memberships m WHERE m.user_id = "persons"."user_id" AND m.status = 'active'
)`;

const RESIDENT_ROLES = Object.values(RELATIONSHIP_ROLE);

@Injectable()
export class ResidentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- consulta

  async list(tenant: TenantContext, query: ListResidentsQueryDto): Promise<Paginated<ResidentListItem>> {
    return this.database.tenant(tenant, async (tx) => {
      const pattern = query.search ? likePattern(query.search) : undefined;
      const hasOccupancyFilter = Boolean(query.towerId || query.propertyId || query.relationship);
      const where = and(
        isNull(persons.deletedAt),
        query.status === 'active' || hasOccupancyFilter ? occupancyFilter(query) : undefined,
        query.status === 'former' ? sql`NOT ${HAS_ACTIVE_OCCUPANCY}` : undefined,
        pattern
          ? or(
              ilike(sql`${persons.firstName} || ' ' || ${persons.lastName}`, pattern),
              ilike(persons.email, pattern),
              ilike(persons.documentNumber, pattern),
              ilike(persons.phone, pattern),
            )
          : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(persons).where(where);
      const direction = query.direction === 'desc' ? desc : asc;
      const rows = await this.selectPersons(tx)
        .where(where)
        .orderBy(
          ...(query.sort === 'createdAt'
            ? [direction(persons.createdAt)]
            : [direction(sql`lower(${persons.lastName})`), direction(sql`lower(${persons.firstName})`)]),
          asc(persons.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const occupancies = await this.occupanciesByPerson(
        tx,
        rows.map((row) => row.person.id),
        { onlyActive: true },
      );
      const items = rows.map((row) => toListItem(row, occupancies.get(row.person.id) ?? []));
      return paginate(items, total?.value ?? 0, query.page, query.pageSize);
    });
  }

  async get(tenant: TenantContext, personId: string): Promise<ResidentDetail> {
    return this.database.tenant(tenant, async (tx) => {
      const [row] = await this.selectPersons(tx).where(and(eq(persons.id, personId), isNull(persons.deletedAt)));
      if (!row) throw AppError.notFound('No encontramos a esta persona.');

      const history = (await this.occupanciesByPerson(tx, [personId], { onlyActive: false })).get(personId) ?? [];
      const active = history.filter((item) => item.endDate === null);
      const propertyIds = active.map((item) => item.propertyId);
      const labelOf = (propertyId: string | null) =>
        active.find((item) => item.propertyId === propertyId)?.propertyLabel ?? '';

      // Consultas en serie: una transacción usa una sola conexión.
      const hasUnits = propertyIds.length > 0;
      const parking = hasUnits
        ? await tx.select().from(parkingSpaces).where(inArray(parkingSpaces.propertyId, propertyIds)).orderBy(parkingSpaces.number)
        : [];
      const storage = hasUnits
        ? await tx.select().from(storageUnits).where(inArray(storageUnits.propertyId, propertyIds)).orderBy(storageUnits.number)
        : [];
      const petRows = hasUnits
        ? await tx
            .select()
            .from(pets)
            .where(and(inArray(pets.propertyId, propertyIds), eq(pets.isActive, true)))
            .orderBy(pets.createdAt)
        : [];
      const flags = await tx
        .select({ available: propertyOccupancies.libertadTradicionAvailable })
        .from(propertyOccupancies)
        .where(and(eq(propertyOccupancies.personId, personId), isNull(propertyOccupancies.endDate)));
      const changes = await this.changes(tx, personId);

      return {
        ...toListItem(row, active),
        documentType: row.person.documentType as DocumentType | null,
        documentNumber: row.person.documentNumber,
        gender: row.person.gender,
        birthDate: row.person.birthDate,
        occupancyHistory: history,
        parkingSpaces: parking.map((item) => ({
          id: item.id,
          number: item.number,
          kind: item.kind,
          propertyLabel: labelOf(item.propertyId),
        })),
        storageUnits: storage.map((item) => ({ id: item.id, number: item.number, propertyLabel: labelOf(item.propertyId) })),
        pets: petRows.map((item) => ({
          id: item.id,
          species: item.species,
          breed: item.breed,
          name: item.name,
          propertyLabel: labelOf(item.propertyId),
        })),
        libertadTradicionAvailable: flags.some((item) => item.available),
        changes,
      };
    });
  }

  async checkDuplicates(tenant: TenantContext, query: CheckDuplicateQueryDto): Promise<DuplicateMatch[]> {
    return this.database.tenant(tenant, (tx) => this.findDuplicates(tx, query));
  }

  // ---------------------------------------------------------------- registro

  /** Guarda todo el asistente "Registrar residente" en una sola transacción. */
  async create(tenant: TenantContext, input: CreateResidentDto, meta: RequestMeta): Promise<CreateResidentResponse> {
    try {
      return await this.database.tenant(tenant, async (tx) => {
        const property = await this.findActiveProperty(tx, input.propertyId);
        const person = input.existingPersonId
          ? await this.findPerson(tx, input.existingPersonId)
          : await this.insertPerson(tx, tenant, input.person!);

        const [alreadyLinked] = await tx
          .select({ id: propertyOccupancies.id })
          .from(propertyOccupancies)
          .where(
            and(
              eq(propertyOccupancies.personId, person.id),
              eq(propertyOccupancies.propertyId, property.id),
              isNull(propertyOccupancies.endDate),
            ),
          );
        if (alreadyLinked) {
          throw AppError.conflict('OCCUPANCY_EXISTS', `Esta persona ya está vinculada a ${property.label}.`, {
            fields: { propertyId: 'La persona ya está vinculada a esta unidad' },
          });
        }

        const [occupancy] = await tx
          .insert(propertyOccupancies)
          .values({
            tenantId: tenant.tenantId,
            propertyId: property.id,
            personId: person.id,
            relationship: input.relationship,
            startDate: input.startDate,
            householdSize: input.householdSize,
            libertadTradicionAvailable: input.libertadTradicionAvailable,
            createdBy: tenant.userId,
          })
          .returning({ id: propertyOccupancies.id });

        await this.assignNumberedAssets(tx, tenant, property, 'parking', input.parkingSpaces);
        await this.assignNumberedAssets(tx, tenant, property, 'storage', input.storageUnits);
        if (input.pets.length > 0) {
          await tx.insert(pets).values(
            input.pets.map((pet) => ({
              tenantId: tenant.tenantId,
              propertyId: property.id,
              ownerPersonId: person.id,
              ...pet,
            })),
          );
        }

        const invitationSent = input.sendInvitation
          ? await this.grantAccess(tx, tenant, person, input.relationship)
          : false;

        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: input.existingPersonId ? 'resident.linked' : 'resident.created',
          entityType: 'person',
          entityId: person.id,
          summary: `Registró a ${person.firstName} ${person.lastName} como ${RELATIONSHIP_LABELS[input.relationship].toLowerCase()} de ${property.label}`,
          changes: {
            propertyId: property.id,
            relationship: input.relationship,
            startDate: input.startDate,
            parkingSpaces: input.parkingSpaces.map((item) => item.number),
            storageUnits: input.storageUnits.map((item) => item.number),
            pets: input.pets.length,
            invitationSent,
          },
          meta,
        });
        return { personId: person.id, occupancyId: occupancy!.id, invitationSent };
      });
    } catch (error) {
      // Dos administradores registrando lo mismo a la vez: la restricción única decide.
      if (isUniqueViolation(error)) {
        throw AppError.conflict('CONFLICT', 'Alguien acaba de registrar esta misma información. Actualiza y revisa.');
      }
      throw error;
    }
  }

  async update(tenant: TenantContext, personId: string, input: UpdateResidentDto, meta: RequestMeta): Promise<void> {
    try {
      await this.database.tenant(tenant, async (tx) => {
        const current = await this.findPerson(tx, personId);
        await this.assertNoDuplicates(tx, input, personId);
        const next = {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone,
          gender: input.gender ?? null,
          birthDate: input.birthDate ?? null,
          documentType: input.documentNumber ? (input.documentType ?? null) : null,
          documentNumber: input.documentNumber ?? null,
        };
        await tx.update(persons).set(next).where(eq(persons.id, personId));

        const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => current[key] !== next[key]);
        if (changed.length === 0) return;
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'resident.updated',
          entityType: 'person',
          entityId: personId,
          summary: `Actualizó ${changed.map((key) => FIELD_LABELS[key]).join(', ')}`,
          changes: Object.fromEntries(changed.map((key) => [key, { before: current[key], after: next[key] }])),
          meta,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('DUPLICATE_PERSON', 'Ya existe otra persona con ese correo o documento.');
      }
      throw error;
    }
  }

  /** Termina una vinculación. La fila se conserva como historial de ocupación. */
  async endOccupancy(
    tenant: TenantContext,
    personId: string,
    occupancyId: string,
    endDate: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.database.tenant(tenant, async (tx) => {
      const person = await this.findPerson(tx, personId);
      const [occupancy] = await tx
        .select()
        .from(propertyOccupancies)
        .where(and(eq(propertyOccupancies.id, occupancyId), eq(propertyOccupancies.personId, personId)))
        .for('update');
      if (!occupancy) throw AppError.notFound('No encontramos la vinculación.');
      if (occupancy.endDate) {
        throw AppError.conflict('OCCUPANCY_ALREADY_ENDED', 'Esta vinculación ya había terminado.');
      }
      if (endDate < occupancy.startDate) {
        throw AppError.unprocessable('INVALID_END_DATE', 'La fecha de salida no puede ser anterior a la de ingreso.', {
          fields: { endDate: 'Debe ser igual o posterior a la fecha de ingreso' },
        });
      }
      await tx.update(propertyOccupancies).set({ endDate }).where(eq(propertyOccupancies.id, occupancyId));

      // Sin vinculaciones vigentes la persona deja de ser residente: se suspende su acceso al portal.
      const [remaining] = await tx
        .select({ value: count() })
        .from(propertyOccupancies)
        .where(and(eq(propertyOccupancies.personId, personId), isNull(propertyOccupancies.endDate)));
      let accessSuspended = false;
      if ((remaining?.value ?? 0) === 0 && person.userId) {
        const suspended = await this.identity.setMembershipStatus(tx, {
          tenantId: tenant.tenantId,
          userId: person.userId,
          roleKeys: RESIDENT_ROLES,
          status: 'suspended',
        });
        accessSuspended = suspended > 0;
      }

      const property = await this.findPropertyLabel(tx, occupancy.propertyId);
      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: 'resident.occupancy_ended',
        entityType: 'person',
        entityId: personId,
        summary: `Terminó la vinculación con ${property}${accessSuspended ? ' y se suspendió su acceso al portal' : ''}`,
        changes: { occupancyId, endDate, accessSuspended },
        meta,
      });
    });
  }

  /** Activa o desactiva el acceso de la persona al portal de este conjunto. */
  async setAccess(
    tenant: TenantContext,
    personId: string,
    enabled: boolean,
    meta: RequestMeta,
  ): Promise<{ accessStatus: AccessStatus; invitationSent: boolean }> {
    return this.database.tenant(tenant, async (tx) => {
      const person = await this.findPerson(tx, personId);
      let invitationSent = false;

      if (enabled) {
        const [latest] = await tx
          .select({ relationship: propertyOccupancies.relationship })
          .from(propertyOccupancies)
          .where(and(eq(propertyOccupancies.personId, personId), isNull(propertyOccupancies.endDate)))
          .orderBy(desc(propertyOccupancies.startDate))
          .limit(1);
        if (!latest) {
          throw AppError.unprocessable(
            'NO_ACTIVE_OCCUPANCY',
            'Esta persona no tiene una vinculación vigente. Vincúlala a una unidad antes de darle acceso.',
          );
        }
        invitationSent = await this.grantAccess(tx, tenant, person, latest.relationship);
      } else if (person.userId) {
        await this.identity.setMembershipStatus(tx, {
          tenantId: tenant.tenantId,
          userId: person.userId,
          roleKeys: RESIDENT_ROLES,
          status: 'suspended',
        });
      }

      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: enabled ? 'resident.access_enabled' : 'resident.access_disabled',
        entityType: 'person',
        entityId: personId,
        summary: enabled
          ? invitationSent
            ? 'Activó el acceso al portal y envió la invitación por correo'
            : 'Activó el acceso al portal'
          : 'Desactivó el acceso al portal',
        meta,
      });

      const [row] = await this.selectPersons(tx).where(eq(persons.id, personId));
      return { accessStatus: accessStatusOf(row!), invitationSent };
    });
  }

  // ---------------------------------------------------------------- internos

  private selectPersons(tx: Tx) {
    return tx
      .select({
        person: persons,
        userStatus: users.status,
        hasActiveMembership: HAS_ACTIVE_MEMBERSHIP,
      })
      .from(persons)
      .leftJoin(users, eq(users.id, persons.userId))
      .$dynamic();
  }

  private async findPerson(tx: Tx, personId: string): Promise<Person> {
    const [person] = await tx
      .select()
      .from(persons)
      .where(and(eq(persons.id, personId), isNull(persons.deletedAt)));
    if (!person) throw AppError.notFound('No encontramos a esta persona.');
    return person;
  }

  private async insertPerson(tx: Tx, tenant: TenantContext, input: NonNullable<CreateResidentDto['person']>) {
    await this.assertNoDuplicates(tx, input);
    const [person] = await tx
      .insert(persons)
      .values({
        tenantId: tenant.tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        documentType: input.documentNumber ? input.documentType : undefined,
        documentNumber: input.documentNumber,
        gender: input.gender,
        birthDate: input.birthDate,
        createdBy: tenant.userId,
      })
      .returning();
    return person!;
  }

  private async findDuplicates(
    tx: Tx,
    query: { email?: string; documentNumber?: string; excludePersonId?: string },
  ): Promise<DuplicateMatch[]> {
    if (!query.email && !query.documentNumber) return [];
    const rows = await tx
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        email: persons.email,
        hasActiveOccupancy: HAS_ACTIVE_OCCUPANCY,
      })
      .from(persons)
      .where(
        and(
          isNull(persons.deletedAt),
          query.excludePersonId ? ne(persons.id, query.excludePersonId) : undefined,
          or(
            query.email ? eq(sql`lower(${persons.email})`, query.email.toLowerCase()) : undefined,
            query.documentNumber ? eq(persons.documentNumber, query.documentNumber) : undefined,
          ),
        ),
      )
      .limit(5);
    return rows.map((row) => ({
      personId: row.id,
      fullName: `${row.firstName} ${row.lastName}`,
      matchedBy: query.email && row.email?.toLowerCase() === query.email.toLowerCase() ? 'email' : 'document',
      hasActiveOccupancy: row.hasActiveOccupancy,
    }));
  }

  private async assertNoDuplicates(
    tx: Tx,
    input: { email?: string; documentNumber?: string },
    excludePersonId?: string,
  ): Promise<void> {
    const matches = await this.findDuplicates(tx, { ...input, excludePersonId });
    const [first] = matches;
    if (!first) return;
    const field = first.matchedBy === 'email' ? 'email' : 'documentNumber';
    throw AppError.conflict(
      'DUPLICATE_PERSON',
      `${first.fullName} ya está registrada con ese ${first.matchedBy === 'email' ? 'correo' : 'documento'}.`,
      {
        fields: { [`person.${field}`]: 'Ya hay una persona registrada con este dato', [field]: 'Ya hay una persona registrada con este dato' },
        details: { matches },
      },
    );
  }

  private async findActiveProperty(tx: Tx, propertyId: string): Promise<{ id: string; label: string }> {
    const [row] = await tx
      .select({ id: properties.id, kind: properties.kind, number: properties.number, towerName: towers.name })
      .from(properties)
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .where(and(eq(properties.id, propertyId), eq(properties.isActive, true)));
    if (!row) {
      throw AppError.unprocessable('PROPERTY_NOT_FOUND', 'La unidad seleccionada no existe o está desactivada.', {
        fields: { propertyId: 'Selecciona una unidad válida' },
      });
    }
    return { id: row.id, label: propertyLabel(row.kind, row.number, row.towerName) };
  }

  private async findPropertyLabel(tx: Tx, propertyId: string): Promise<string> {
    const [row] = await tx
      .select({ kind: properties.kind, number: properties.number, towerName: towers.name })
      .from(properties)
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .where(eq(properties.id, propertyId));
    return row ? propertyLabel(row.kind, row.number, row.towerName) : 'la unidad';
  }

  /**
   * Asigna parqueaderos o depósitos a la unidad. Si el número ya existe y está libre se
   * reutiliza; si pertenece a otra unidad se rechaza para no quitárselo en silencio.
   */
  private async assignNumberedAssets(
    tx: Tx,
    tenant: TenantContext,
    property: { id: string; label: string },
    type: 'parking' | 'storage',
    items: { number: string; kind?: 'car' | 'motorcycle' | 'bicycle' }[],
  ): Promise<void> {
    const table = type === 'parking' ? parkingSpaces : storageUnits;
    const noun = type === 'parking' ? 'El parqueadero' : 'El depósito';
    const field = type === 'parking' ? 'parkingSpaces' : 'storageUnits';

    for (const [index, item] of items.entries()) {
      const [existing] = await tx
        .select({ id: table.id, propertyId: table.propertyId })
        .from(table)
        .where(eq(sql`lower(${table.number})`, item.number.toLowerCase()))
        .for('update');
      if (existing?.propertyId && existing.propertyId !== property.id) {
        const owner = await this.findPropertyLabel(tx, existing.propertyId);
        throw AppError.conflict('ASSET_ALREADY_ASSIGNED', `${noun} ${item.number} ya está asignado a ${owner}.`, {
          fields: { [`${field}.${index}.number`]: `Ya está asignado a ${owner}` },
        });
      }
      if (existing) {
        await tx.update(table).set({ propertyId: property.id }).where(eq(table.id, existing.id));
      } else if (type === 'parking') {
        await tx
          .insert(parkingSpaces)
          .values({ tenantId: tenant.tenantId, number: item.number, kind: item.kind ?? 'car', propertyId: property.id });
      } else {
        await tx.insert(storageUnits).values({ tenantId: tenant.tenantId, number: item.number, propertyId: property.id });
      }
    }
  }

  /**
   * Da acceso al portal: crea (o reutiliza) la cuenta del correo de la persona, le asigna
   * el rol según su vinculación y, si aún no tiene contraseña, le envía la invitación.
   * Devuelve true si se envió una invitación.
   */
  private async grantAccess(tx: Tx, tenant: TenantContext, person: Person, relationship: RelationshipType) {
    if (!person.email) {
      throw AppError.unprocessable('EMAIL_REQUIRED', 'Para dar acceso al portal registra primero el correo de la persona.', {
        fields: { 'person.email': 'Escribe el correo para enviar la invitación', email: 'Escribe el correo' },
      });
    }
    const { user } = person.userId
      ? { user: (await tx.select().from(users).where(eq(users.id, person.userId)))[0]! }
      : await this.identity.ensureUser(tx, {
          email: person.email,
          displayName: `${person.firstName} ${person.lastName}`,
        });
    if (user.status === 'disabled') {
      throw AppError.unprocessable('ACCOUNT_DISABLED', 'La cuenta de esta persona está desactivada en la plataforma.');
    }
    if (!person.userId) {
      await tx.update(persons).set({ userId: user.id }).where(eq(persons.id, person.id));
    }
    await this.identity.ensureMembership(tx, {
      tenantId: tenant.tenantId,
      userId: user.id,
      roleKey: RELATIONSHIP_ROLE[relationship],
      createdBy: tenant.userId,
    });
    if (user.status !== 'invited') return false;

    const [tenantRow] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenant.tenantId));
    await this.identity.issueInvitation(tx, {
      user,
      tenantId: tenant.tenantId,
      brandName: tenantRow?.name ?? 'Brisas',
    });
    return true;
  }

  private async occupanciesByPerson(tx: Tx, personIds: string[], options: { onlyActive: boolean }) {
    const byPerson = new Map<string, OccupancySummary[]>();
    if (personIds.length === 0) return byPerson;
    const rows = await tx
      .select({
        id: propertyOccupancies.id,
        personId: propertyOccupancies.personId,
        propertyId: propertyOccupancies.propertyId,
        relationship: propertyOccupancies.relationship,
        startDate: propertyOccupancies.startDate,
        endDate: propertyOccupancies.endDate,
        householdSize: propertyOccupancies.householdSize,
        kind: properties.kind,
        number: properties.number,
        towerName: towers.name,
      })
      .from(propertyOccupancies)
      .innerJoin(properties, eq(properties.id, propertyOccupancies.propertyId))
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .where(
        and(
          inArray(propertyOccupancies.personId, personIds),
          options.onlyActive ? isNull(propertyOccupancies.endDate) : undefined,
        ),
      )
      .orderBy(sql`${propertyOccupancies.endDate} DESC NULLS FIRST`, desc(propertyOccupancies.startDate));
    for (const { personId, kind, number, towerName, ...occupancy } of rows) {
      const list = byPerson.get(personId) ?? [];
      list.push({ ...occupancy, propertyLabel: propertyLabel(kind, number, towerName) });
      byPerson.set(personId, list);
    }
    return byPerson;
  }

  private async changes(tx: Tx, personId: string) {
    const rows = await tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        summary: auditLogs.summary,
        actorName: users.displayName,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.entityType, 'person'), eq(auditLogs.entityId, personId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}

const FIELD_LABELS = {
  firstName: 'nombres',
  lastName: 'apellidos',
  email: 'correo',
  phone: 'celular',
  gender: 'género',
  birthDate: 'fecha de nacimiento',
  documentType: 'tipo de documento',
  documentNumber: 'número de documento',
} as const;

interface PersonRow {
  person: Person;
  userStatus: 'invited' | 'active' | 'disabled' | null;
  hasActiveMembership: boolean;
}

function accessStatusOf(row: PersonRow): AccessStatus {
  if (!row.person.userId || !row.userStatus) return 'none';
  if (row.userStatus === 'disabled' || !row.hasActiveMembership) return 'disabled';
  return row.userStatus === 'invited' ? 'invited' : 'active';
}

function toListItem(row: PersonRow, occupancies: OccupancySummary[]): ResidentListItem {
  return {
    personId: row.person.id,
    firstName: row.person.firstName,
    lastName: row.person.lastName,
    email: row.person.email,
    phone: row.person.phone,
    accessStatus: accessStatusOf(row),
    occupancies,
    createdAt: row.person.createdAt.toISOString(),
  };
}

/** Condición "tiene una vinculación que cumple los filtros" para el listado. */
function occupancyFilter(query: ListResidentsQueryDto): SQL {
  const conditions: SQL[] = [sql`o.person_id = "persons"."id"`];
  if (query.status === 'active') conditions.push(sql`o.end_date IS NULL`);
  if (query.propertyId) conditions.push(sql`o.property_id = ${query.propertyId}`);
  if (query.towerId) conditions.push(sql`pr.tower_id = ${query.towerId}`);
  if (query.relationship) conditions.push(sql`o.relationship = ${query.relationship}`);
  return sql`EXISTS (
    SELECT 1 FROM property_occupancies o
    JOIN properties pr ON pr.id = o.property_id
    WHERE ${sql.join(conditions, sql` AND `)}
  )`;
}
