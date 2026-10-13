import { z } from 'zod';
import { emailSchema, optionalText, paginationQuerySchema } from './common';

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Mínimo 3 caracteres')
  .max(40, 'Máximo 40 caracteres')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Usa solo minúsculas, números y guiones');

export const createTenantSchema = z.object({
  name: z.string().trim().min(3, 'Escribe el nombre del conjunto').max(120),
  slug: tenantSlugSchema,
  taxId: optionalText(30),
  city: optionalText(80),
  address: optionalText(200),
  planKey: z.string().trim().min(1).max(40).default('basic'),
  /** Primer administrador del conjunto: recibe una invitación por correo. */
  admin: z.object({
    firstName: z.string().trim().min(1, 'Escribe el nombre').max(80),
    lastName: z.string().trim().min(1, 'Escribe el apellido').max(80),
    email: emailSchema,
  }),
});
export type CreateTenantInput = z.input<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(3, 'Escribe el nombre del conjunto').max(120).optional(),
  taxId: optionalText(30),
  planKey: z.string().trim().min(1).max(40).optional(),
});
export type UpdateTenantInput = z.input<typeof updateTenantSchema>;

export const setTenantStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });

export const listTenantsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  taxId: string | null;
  status: 'active' | 'suspended';
  planKey: string;
  planName: string;
  city: string | null;
  unitsCount: number;
  activeResidentsCount: number;
  createdAt: string;
}

export interface PlatformMetrics {
  tenantsActive: number;
  tenantsSuspended: number;
  unitsTotal: number;
  usersActive: number;
}

export interface PlanSummary {
  key: string;
  name: string;
  maxUnits: number | null;
}

export interface TenantBranding {
  tenantId: string;
  slug: string;
  name: string;
  primaryColor: string | null;
  welcomeMessage: string | null;
  address: string | null;
  city: string | null;
  phones: string[];
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  officeHours: string | null;
}

export interface TenantDashboard {
  activeResidents: number;
  units: number;
  occupiedUnits: number;
  towers: number;
  pets: number;
  parkingSpaces: number;
  residentsWithAccess: number;
  pendingInvitations: number;
}
