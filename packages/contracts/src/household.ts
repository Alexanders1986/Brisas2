import { z } from 'zod';
import { dateOnlySchema, emailSchema, optionalText, phoneSchema } from './common';
import type { HouseholdPet } from './household-pets';

export const GENDERS = ['female', 'male', 'other', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  female: 'Mujer',
  male: 'Hombre',
  other: 'Otro',
  undisclosed: 'Prefiero no decirlo',
};

export const KINSHIPS = [
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
] as const;
export type Kinship = (typeof KINSHIPS)[number];
/** Parentesco con el residente principal de la unidad. */
export const KINSHIP_LABELS: Record<Kinship, string> = {
  spouse: 'Esposo o esposa',
  partner: 'Compañero o compañera permanente',
  child: 'Hijo o hija',
  father: 'Padre',
  mother: 'Madre',
  sibling: 'Hermano o hermana',
  grandparent: 'Abuelo o abuela',
  grandchild: 'Nieto o nieta',
  other_relative: 'Otro familiar',
  roommate: 'Compañero de vivienda',
  employee: 'Empleado o empleada del hogar',
  other: 'Otro',
};

const emptyToUndefined = z.literal('').transform(() => undefined);

/** Fecha de nacimiento: una fecha real, no futura y de una persona viva. */
export const birthDateSchema = dateOnlySchema.refine(
  (value) => {
    const today = new Date().toISOString().slice(0, 10);
    return value <= today && value >= '1900-01-01';
  },
  { error: 'Escribe una fecha de nacimiento válida' },
);

/** Edad en años cumplidos a partir de la fecha de nacimiento (AAAA-MM-DD). */
export function ageFrom(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number];
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age;
}

/** Persona que vive en la unidad además del residente principal. */
export const householdMemberSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Escribe los nombres').max(80),
    lastName: z.string().trim().min(1, 'Escribe los apellidos').max(80),
    kinship: z.enum(KINSHIPS, { error: 'Selecciona el parentesco' }),
    gender: z.enum(GENDERS, { error: 'Selecciona una opción' }),
    birthDate: birthDateSchema,
    /** Opcional para los acompañantes; obligatorio solo para el residente principal. */
    phone: z.union([emptyToUndefined, phoneSchema]).optional(),
    email: z.union([emptyToUndefined, emailSchema]).optional(),
    /** Si se marca, esta persona también recibe las notificaciones del conjunto. */
    receivesNotifications: z.boolean().default(false),
  })
  .refine((value) => !value.receivesNotifications || value.phone || value.email, {
    error: 'Para enviarle notificaciones escribe su celular o su correo',
    path: ['phone'],
  });
export type HouseholdMemberInput = z.input<typeof householdMemberSchema>;

export const VEHICLE_KINDS = ['car', 'motorcycle', 'bicycle', 'scooter', 'other'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  car: 'Carro',
  motorcycle: 'Moto',
  bicycle: 'Bicicleta',
  scooter: 'Patineta o scooter',
  other: 'Otro',
};

export const POWERTRAINS = ['combustion', 'electric', 'hybrid', 'human'] as const;
export type Powertrain = (typeof POWERTRAINS)[number];
export const POWERTRAIN_LABELS: Record<Powertrain, string> = {
  combustion: 'Gasolina, diésel o gas',
  electric: 'Eléctrico',
  hybrid: 'Híbrido',
  human: 'Sin motor',
};

const MAX_MODEL_YEAR = new Date().getFullYear() + 1;

export const vehicleSchema = z
  .object({
    kind: z.enum(VEHICLE_KINDS, { error: 'Selecciona el tipo de vehículo' }),
    powertrain: z.enum(POWERTRAINS, { error: 'Selecciona una opción' }),
    /** Se guarda en mayúsculas y sin espacios ni guiones: "abc-123" → "ABC123". */
    plate: z
      .union([
        emptyToUndefined,
        z
          .string()
          .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
          .pipe(z.string().regex(/^[A-Z0-9]{5,7}$/, 'Escribe la placa, por ejemplo ABC123')),
      ])
      .optional(),
    brand: optionalText(40),
    model: optionalText(40),
    modelYear: z
      .union([
        emptyToUndefined,
        z.coerce.number().int().min(1950, 'Año no válido').max(MAX_MODEL_YEAR, 'Año no válido'),
      ])
      .optional(),
    color: z.string().trim().min(1, 'Escribe el color').max(30),
    notes: optionalText(200),
  })
  .refine((value) => !['car', 'motorcycle'].includes(value.kind) || value.plate, {
    error: 'La placa es obligatoria para carros y motos',
    path: ['plate'],
  });
export type VehicleInput = z.input<typeof vehicleSchema>;

// ---------------------------------------------------------------- respuestas

export interface HouseholdMember {
  id: string;
  firstName: string;
  lastName: string;
  kinship: Kinship;
  gender: Gender;
  birthDate: string;
  phone: string | null;
  email: string | null;
  receivesNotifications: boolean;
}

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  powertrain: Powertrain;
  plate: string | null;
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  color: string;
  notes: string | null;
}

/** Quiénes viven en una unidad y qué vehículos tienen. */
export interface PropertyHousehold {
  propertyId: string;
  propertyLabel: string;
  /** Personas con vinculación vigente (propietarios, arrendatarios, autorizados). */
  residents: { personId: string; fullName: string; relationship: 'owner' | 'tenant' | 'authorized' }[];
  members: HouseholdMember[];
  vehicles: Vehicle[];
  pets: HouseholdPet[];
  /** true si quien consulta puede agregar o editar personas y vehículos de esta unidad. */
  canManage: boolean;
}

export interface MyHouseholdResponse {
  units: PropertyHousehold[];
}
