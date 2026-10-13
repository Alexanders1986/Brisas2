import {
  createTenantSchema,
  listTenantsQuerySchema,
  setTenantStatusSchema,
  updateTenantSchema,
} from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTenantDto extends createZodDto(createTenantSchema) {}
export class UpdateTenantDto extends createZodDto(updateTenantSchema) {}
export class SetTenantStatusDto extends createZodDto(setTenantStatusSchema) {}
export class ListTenantsQueryDto extends createZodDto(listTenantsQuerySchema) {}
