import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './_shared';
import { users } from './identity';
import { tenants } from './platform';

export const towerKind = pgEnum('tower_kind', ['tower', 'block', 'stage']);
export const propertyKind = pgEnum('property_kind', ['apartment', 'house', 'commercial']);
export const relationshipType = pgEnum('relationship_type', ['owner', 'tenant', 'authorized']);
export const parkingKind = pgEnum('parking_kind', ['car', 'motorcycle', 'bicycle']);
export const petSpecies = pgEnum('pet_species', ['dog', 'cat', 'bird', 'other']);
export const petSex = pgEnum('pet_sex', ['male', 'female']);
export const gender = pgEnum('gender',['female', 'male', 'other', 'undisclosed']);
export const kinship = pgEnum('kinship', [
  'spouse',
  'partner',
  'child',
  'father',
  'mother',
  'sibling',
  'grandparent',
  'grandchild',
  'other_relative',
  'roommate',
  'employee',
  'other',
]);
export const vehicleKind = pgEnum('vehicle_kind', ['car', 'motorcycle', 'bicycle', 'scooter', 'other']);
export const powertrain = pgEnum('powertrain', ['combustion', 'electric', 'hybrid', 'human']);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/*
 * Las tablas hijas referencian a sus padres con claves foráneas compuestas
 * (tenant_id, id). Así la base de datos impide, por construcción, que una fila
 * de un conjunto apunte a una fila de otro, aunque la aplicación se equivoque.
 */

export const towers = pgTable(
  'towers',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    name: varchar('name', { length: 60 }).notNull(),
    kind: towerKind('kind').notNull().default('tower'),
    floors: integer('floors'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('towers_tenant_id_id_key').on(t.tenantId, t.id),
    uniqueIndex('towers_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`),
    check('towers_floors_positive', sql`${t.floors} IS NULL OR ${t.floors} > 0`),
  ],
);

/** Unidad residencial (apartamento, casa o local). */
export const properties = pgTable(
  'properties',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    towerId: uuid('tower_id'),
    kind: propertyKind('kind').notNull().default('apartment'),
    number: varchar('number', { length: 20 }).notNull(),
    floor: integer('floor'),
    areaM2: numeric('area_m2', { precision: 9, scale: 2, mode: 'number' }),
    /** Coeficiente de copropiedad (0 a 1). */
    coefficient: numeric('coefficient', { precision: 9, scale: 8, mode: 'number' }),
    notes: varchar('notes', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('properties_tenant_id_id_key').on(t.tenantId, t.id),
    unique('properties_tenant_tower_number_key').on(t.tenantId, t.towerId, t.number).nullsNotDistinct(),
    foreignKey({
      name: 'properties_tower_fk',
      columns: [t.tenantId, t.towerId],
      foreignColumns: [towers.tenantId, towers.id],
    }).onDelete('restrict'),
    index('properties_tenant_tower_idx').on(t.tenantId, t.towerId),
    check('properties_coefficient_range', sql`${t.coefficient} IS NULL OR (${t.coefficient} >= 0 AND ${t.coefficient} <= 1)`),
  ],
);

/**
 * Persona natural registrada en un conjunto. Es distinta del Usuario (cuenta de acceso):
 * una persona puede no tener cuenta, y se enlaza a una mediante user_id cuando se le invita.
 */
export const persons = pgTable(
  'persons',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 20 }),
    documentType: varchar('document_type', { length: 5 }),
    documentNumber: varchar('document_number', { length: 20 }),
    gender: gender('gender'),
    birthDate: date('birth_date', { mode: 'string' }),
    deletedAt: timestamptz('deleted_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('persons_tenant_id_id_key').on(t.tenantId, t.id),
    // Prevención de duplicados dentro de un mismo conjunto.
    uniqueIndex('persons_tenant_email_key')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('persons_tenant_document_key')
      .on(t.tenantId, t.documentType, t.documentNumber)
      .where(sql`${t.documentNumber} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('persons_tenant_user_key').on(t.tenantId, t.userId).where(sql`${t.userId} IS NOT NULL`),
    index('persons_tenant_name_idx').on(t.tenantId, t.lastName, t.firstName),
    check(
      'persons_document_complete',
      sql`(${t.documentNumber} IS NULL) OR (${t.documentType} IS NOT NULL)`,
    ),
  ],
);

/**
 * Vinculación de una persona con una unidad. Una fila con end_date null es la
 * ocupación vigente; al terminar se conserva como historial de ocupación.
 */
export const propertyOccupancies = pgTable(
  'property_occupancies',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    propertyId: uuid('property_id').notNull(),
    personId: uuid('person_id').notNull(),
    relationship: relationshipType('relationship').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    /** Número total de personas que viven en la unidad con este hogar. */
    householdSize: integer('household_size').notNull().default(1),
    /** ¿La administración cuenta con el certificado de libertad y tradición? */
    libertadTradicionAvailable: boolean('libertad_tradicion_available').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('property_occupancies_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'property_occupancies_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'property_occupancies_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [persons.tenantId, persons.id],
    }).onDelete('restrict'),
    // Una persona no puede tener dos vinculaciones vigentes con la misma unidad.
    uniqueIndex('property_occupancies_active_key').on(t.propertyId, t.personId).where(sql`${t.endDate} IS NULL`),
    index('property_occupancies_tenant_person_idx').on(t.tenantId, t.personId),
    index('property_occupancies_tenant_property_idx').on(t.tenantId, t.propertyId),
    check('property_occupancies_dates', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check('property_occupancies_household_size', sql`${t.householdSize} >= 1`),
  ],
);

export const parkingSpaces = pgTable(
  'parking_spaces',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    number: varchar('number', { length: 20 }).notNull(),
    kind: parkingKind('kind').notNull().default('car'),
    /** Unidad a la que está asignado; null = sin asignar. */
    propertyId: uuid('property_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('parking_spaces_tenant_number_key').on(t.tenantId, sql`lower(${t.number})`),
    foreignKey({
      name: 'parking_spaces_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    index('parking_spaces_tenant_property_idx').on(t.tenantId, t.propertyId),
  ],
);

export const storageUnits = pgTable(
  'storage_units',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    number: varchar('number', { length: 20 }).notNull(),
    propertyId: uuid('property_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('storage_units_tenant_number_key').on(t.tenantId, sql`lower(${t.number})`),
    foreignKey({
      name: 'storage_units_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    index('storage_units_tenant_property_idx').on(t.tenantId, t.propertyId),
  ],
);

export const pets = pgTable(
  'pets',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    propertyId: uuid('property_id').notNull(),
    /** Persona responsable; se conserva la mascota en la unidad aunque la persona se desvincule. */
    ownerPersonId: uuid('owner_person_id'),
    species: petSpecies('species').notNull(),
    breed: varchar('breed', { length: 60 }),
    name: varchar('name', { length: 60 }),
    sex: petSex('sex'),
    color: varchar('color', { length: 30 }),
    vaccinesUpToDate: boolean('vaccines_up_to_date').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'pets_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pets_owner_person_fk',
      columns: [t.tenantId, t.ownerPersonId],
      foreignColumns: [persons.tenantId, persons.id],
    }).onDelete('restrict'),
    index('pets_tenant_property_idx').on(t.tenantId, t.propertyId),
  ],
);

/**
 * Persona que vive en la unidad sin ser titular de una vinculación (cónyuge, hijos,
 * padres…). La registra el propio residente desde el portal. No tiene cuenta de acceso.
 */
export const householdMembers = pgTable(
  'household_members',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    propertyId: uuid('property_id').notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    kinship: kinship('kinship').notNull(),
    gender: gender('gender').notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 254 }),
    /** Esta persona también recibe las notificaciones del conjunto. */
    receivesNotifications: boolean('receives_notifications').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'household_members_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    index('household_members_tenant_property_idx').on(t.tenantId, t.propertyId),
    check(
      'household_members_notification_contact',
      sql`NOT ${t.receivesNotifications} OR ${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`,
    ),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    propertyId: uuid('property_id').notNull(),
    kind: vehicleKind('kind').notNull(),
    powertrain: powertrain('powertrain').notNull(),
    /** En mayúsculas y sin separadores. Obligatoria para carros y motos. */
    plate: varchar('plate', { length: 10 }),
    brand: varchar('brand', { length: 40 }),
    model: varchar('model', { length: 40 }),
    modelYear: integer('model_year'),
    color: varchar('color', { length: 30 }).notNull(),
    notes: varchar('notes', { length: 200 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'vehicles_property_fk',
      columns: [t.tenantId, t.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
    }).onDelete('restrict'),
    // Una placa no puede estar registrada en dos unidades del mismo conjunto.
    uniqueIndex('vehicles_tenant_plate_key').on(t.tenantId, t.plate).where(sql`${t.plate} IS NOT NULL`),
    index('vehicles_tenant_property_idx').on(t.tenantId, t.propertyId),
    check(
      'vehicles_plate_required',
      sql`${t.kind} NOT IN ('car', 'motorcycle') OR ${t.plate} IS NOT NULL`,
    ),
  ],
);
