import {
  generatePropertiesSchema,
  listPropertiesQuerySchema,
  propertyInputSchema,
  towerInputSchema,
  updatePropertySchema,
} from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';

export class TowerDto extends createZodDto(towerInputSchema) {}
export class PropertyDto extends createZodDto(propertyInputSchema) {}
export class UpdatePropertyDto extends createZodDto(updatePropertySchema) {}
export class GeneratePropertiesDto extends createZodDto(generatePropertiesSchema) {}
export class ListPropertiesQueryDto extends createZodDto(listPropertiesQuerySchema) {}
