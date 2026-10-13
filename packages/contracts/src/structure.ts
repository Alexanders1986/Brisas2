import { z } from 'zod';
import { optionalText, paginationQuerySchema, queryBooleanSchema, uuidSchema } from './common';

export const PROPERTY_KINDS = ['apartment', 'house', 'commercial'] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];
export const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  commercial: 'Local',
};
export const PROPERTY_KIND_SHORT: Record<PropertyKind, string> = {
  apartment: 'Apto',
  house: 'Casa',
  commercial: 'Local',
};

export const TOWER_KINDS = ['tower', 'block', 'stage'] as const;
export type TowerKind = (typeof TOWER_KINDS)[number];
export const TOWER_KIND_LABELS: Record<TowerKind, string> = { tower: 'Torre', block: 'Bloque', stage: 'Etapa' };

export const towerInputSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre').max(60),
  kind: z.enum(TOWER_KINDS).default('tower'),
  floors: z.coerce.number().int().min(1, 'Mínimo 1 piso').max(200).nullable().optional(),
});
export type TowerInput = z.input<typeof towerInputSchema>;

export const propertyInputSchema = z.object({
  towerId: uuidSchema.nullable().optional(),
  kind: z.enum(PROPERTY_KINDS).default('apartment'),
  number: z.string().trim().min(1, 'Escribe el número').max(20),
  floor: z.coerce.number().int().min(-5).max(200).nullable().optional(),
  areaM2: z.coerce.number().positive().max(100000).nullable().optional(),
  notes: optionalText(500),
});
export type PropertyInput = z.input<typeof propertyInputSchema>;

export const updatePropertySchema = propertyInputSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdatePropertyInput = z.input<typeof updatePropertySchema>;

/**
 * Generador de unidades: crea de una vez todos los apartamentos de una torre
 * numerándolos como <piso><consecutivo de dos dígitos> (p. ej. 101, 102, 201…).
 */
export const generatePropertiesSchema = z
  .object({
    towerId: uuidSchema,
    fromFloor: z.coerce.number().int().min(1, 'Mínimo 1').max(200),
    toFloor: z.coerce.number().int().min(1, 'Mínimo 1').max(200),
    unitsPerFloor: z.coerce.number().int().min(1, 'Mínimo 1').max(40, 'Máximo 40 por piso'),
    kind: z.enum(PROPERTY_KINDS).default('apartment'),
  })
  .refine((value) => value.toFloor >= value.fromFloor, {
    error: 'El piso final debe ser mayor o igual al inicial',
    path: ['toFloor'],
  });
export type GeneratePropertiesInput = z.input<typeof generatePropertiesSchema>;

export const listPropertiesQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  towerId: uuidSchema.optional(),
  search: z.string().trim().max(50).optional(),
  occupancy: z.enum(['occupied', 'vacant']).optional(),
  includeInactive: queryBooleanSchema,
});

export interface TowerSummary {
  id: string;
  name: string;
  kind: TowerKind;
  floors: number | null;
  unitsCount: number;
}

export interface PropertySummary {
  id: string;
  towerId: string | null;
  towerName: string | null;
  kind: PropertyKind;
  number: string;
  floor: number | null;
  areaM2: number | null;
  isActive: boolean;
  activeOccupants: number;
  /** Etiqueta lista para mostrar: "Torre 1 · Apto 302". */
  label: string;
}

export interface GeneratePropertiesResult {
  created: number;
  /** Unidades que ya existían y no se volvieron a crear. */
  skipped: number;
}

export function propertyLabel(kind: PropertyKind, number: string, towerName: string | null): string {
  const unit = `${PROPERTY_KIND_SHORT[kind]} ${number}`;
  return towerName ? `${towerName} · ${unit}` : unit;
}
