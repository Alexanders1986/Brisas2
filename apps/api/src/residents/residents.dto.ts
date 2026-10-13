import {
  checkDuplicateQuerySchema,
  createResidentSchema,
  endOccupancySchema,
  listResidentsQuerySchema,
  setResidentAccessSchema,
  updateResidentSchema,
} from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateResidentDto extends createZodDto(createResidentSchema) {}
export class UpdateResidentDto extends createZodDto(updateResidentSchema) {}
export class ListResidentsQueryDto extends createZodDto(listResidentsQuerySchema) {}
export class CheckDuplicateQueryDto extends createZodDto(checkDuplicateQuerySchema) {}
export class EndOccupancyDto extends createZodDto(endOccupancySchema) {}
export class SetResidentAccessDto extends createZodDto(setResidentAccessSchema) {}
