import { z } from 'zod';
import {
  dateOnlySchema,
  emailSchema,
  optionalText,
  paginationQuerySchema,
  phoneSchema,
  sortDirectionSchema,
  uuidSchema,
} from './common';
import { GENDERS, type Gender, birthDateSchema } from './household';
import { RELATIONSHIP_TYPES, type RelationshipType } from './permissions';

export const DOCUMENT_TYPES = ['CC', 'CE', 'PA', 'TI', 'NIT', 'PPT'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  CC: 'Cédula de ciudadanía',
  CE: 'Cédula de extranjería',
  PA: 'Pasaporte',
  TI: 'Tarjeta de identidad',
  NIT: 'NIT',
  PPT: 'Permiso por protección temporal',
};

export const PARKING_KINDS = ['car', 'motorcycle', 'bicycle'] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];
export const PARKING_KIND_LABELS: Record<ParkingKind, string> = {
  car: 'Carro',
  motorcycle: 'Moto',
  bicycle: 'Bicicleta',
};

export const PET_SPECIES = ['dog', 'cat', 'bird', 'other'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];
export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Perro',
  cat: 'Gato',
  bird: 'Ave',
  other: 'Otro',
};

const emptyToUndefined = z.literal('').transform(() => undefined);
const optionalEmail = z.union([emptyToUndefined, emailSchema]).optional();

export const personInputSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Escribe los nombres').max(80),
    lastName: z.string().trim().min(1, 'Escribe los apellidos').max(80),
    email: optionalEmail,
    /** Obligatorio: es el contacto del residente principal de la unidad. */
    phone: z.string().trim().min(1, 'Escribe el celular').pipe(phoneSchema),
    gender: z.union([emptyToUndefined, z.enum(GENDERS)]).optional(),
    birthDate: z.union([emptyToUndefined, birthDateSchema]).optional(),
    documentType: z.union([emptyToUndefined, z.enum(DOCUMENT_TYPES)]).optional(),
    documentNumber: z
      .union([
        emptyToUndefined,
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9-]{4,20}$/, 'Usa solo letras, números y guiones (4 a 20)'),
      ])
      .optional(),
  })
  .refine((value) => !value.documentNumber || value.documentType, {
    error: 'Selecciona el tipo de documento',
    path: ['documentType'],
  });
export type PersonInput = z.input<typeof personInputSchema>;
export type PersonData = z.output<typeof personInputSchema>;

export const parkingInputSchema = z.object({
  number: z.string().trim().min(1, 'Escribe el número').max(20),
  kind: z.enum(PARKING_KINDS).default('car'),
});
export const storageInputSchema = z.object({
  number: z.string().trim().min(1, 'Escribe el número').max(20),
});
export const petInputSchema = z.object({
  species: z.enum(PET_SPECIES),
  breed: optionalText(60),
  name: optionalText(60),
});

/** Datos completos del asistente "Registrar residente". Se guardan en una sola transacción. */
export const createResidentSchema = z
  .object({
    /** Vincula una persona ya registrada en el conjunto en lugar de crear otra. */
    existingPersonId: uuidSchema.optional(),
    person: personInputSchema.optional(),
    relationship: z.enum(RELATIONSHIP_TYPES, { error: 'Selecciona el tipo de vinculación' }),
    propertyId: uuidSchema,
    startDate: dateOnlySchema,
    householdSize: z.coerce.number().int().min(1, 'Mínimo 1 residente').max(50),
    parkingSpaces: z.array(parkingInputSchema).max(10).default([]),
    storageUnits: z.array(storageInputSchema).max(10).default([]),
    pets: z.array(petInputSchema).max(20).default([]),
    libertadTradicionAvailable: z.boolean().default(false),
    /** Crea la cuenta de acceso y envía la invitación por correo. */
    sendInvitation: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.existingPersonId) !== Boolean(value.person), {
    error: 'Indica los datos de la persona o selecciona una existente',
    path: ['person'],
  })
  .refine((value) => !value.sendInvitation || value.existingPersonId || value.person?.email, {
    error: 'Para enviar la invitación necesitas el correo de la persona',
    path: ['person', 'email'],
  });
export type CreateResidentInput = z.input<typeof createResidentSchema>;
export type CreateResidentData = z.output<typeof createResidentSchema>;

export const updateResidentSchema = personInputSchema;

export const endOccupancySchema = z.object({ endDate: dateOnlySchema });

export const setResidentAccessSchema = z.object({ enabled: z.boolean() });

export const checkDuplicateQuerySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).optional(),
  documentNumber: z.string().trim().toUpperCase().max(20).optional(),
  excludePersonId: uuidSchema.optional(),
});

export const RESIDENT_SORT_FIELDS = ['name', 'createdAt'] as const;

export const listResidentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  towerId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  relationship: z.enum(RELATIONSHIP_TYPES).optional(),
  /** active: con vinculación vigente · former: sin vinculaciones vigentes · all */
  status: z.enum(['active', 'former', 'all']).default('active'),
  sort: z.enum(RESIDENT_SORT_FIELDS).default('name'),
  direction: sortDirectionSchema.default('asc'),
});
export type ListResidentsQuery = z.input<typeof listResidentsQuerySchema>;

// ---------------------------------------------------------------- respuestas

export type AccessStatus = 'none' | 'invited' | 'active' | 'disabled';

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  none: 'Sin acceso',
  invited: 'Invitación enviada',
  active: 'Acceso activo',
  disabled: 'Acceso desactivado',
};

export interface OccupancySummary {
  id: string;
  propertyId: string;
  propertyLabel: string;
  relationship: RelationshipType;
  startDate: string;
  endDate: string | null;
  householdSize: number;
}

export interface ResidentListItem {
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  accessStatus: AccessStatus;
  /** Vinculaciones vigentes. */
  occupancies: OccupancySummary[];
  createdAt: string;
}

export interface ResidentChange {
  id: string;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

export interface ResidentDetail extends ResidentListItem {
  documentType: DocumentType | null;
  documentNumber: string | null;
  gender: Gender | null;
  birthDate: string | null;
  /** Todas las vinculaciones, vigentes y terminadas, de la más reciente a la más antigua. */
  occupancyHistory: OccupancySummary[];
  parkingSpaces: { id: string; number: string; kind: ParkingKind; propertyLabel: string }[];
  storageUnits: { id: string; number: string; propertyLabel: string }[];
  pets: { id: string; species: PetSpecies; breed: string | null; name: string | null; propertyLabel: string }[];
  libertadTradicionAvailable: boolean;
  changes: ResidentChange[];
}

export interface DuplicateMatch {
  personId: string;
  fullName: string;
  matchedBy: 'email' | 'document';
  hasActiveOccupancy: boolean;
}

export interface DuplicateCheckResponse {
  matches: DuplicateMatch[];
}

export interface CreateResidentResponse {
  personId: string;
  occupancyId: string;
  invitationSent: boolean;
}
