import { z } from 'zod';
import { optionalText } from './common';
import { PET_SPECIES, type PetSpecies } from './residents';

export const PET_SEXES = ['male', 'female'] as const;
export type PetSex = (typeof PET_SEXES)[number];
export const PET_SEX_LABELS: Record<PetSex, string> = { male: 'Macho', female: 'Hembra' };

/** Mascota de una unidad, registrada por el residente o por la administración. */
export const householdPetSchema = z.object({
  species: z.enum(PET_SPECIES, { error: 'Selecciona el tipo de animal' }),
  name: z.string().trim().min(1, 'Escribe el nombre').max(60),
  breed: optionalText(60),
  sex: z.union([z.literal('').transform(() => undefined), z.enum(PET_SEXES)]).optional(),
  color: optionalText(30),
  vaccinesUpToDate: z.boolean().default(false),
});
export type HouseholdPetInput = z.input<typeof householdPetSchema>;

export interface HouseholdPet {
  id: string;
  species: PetSpecies;
  /** Las mascotas registradas en el asistente de residentes pueden no tener nombre. */
  name: string | null;
  breed: string | null;
  sex: PetSex | null;
  color: string | null;
  vaccinesUpToDate: boolean;
}
