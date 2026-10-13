import {
  createPqrSchema,
  listPqrQuerySchema,
  pqrCommentSchema,
  pqrReportQuerySchema,
  updatePqrSchema,
} from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreatePqrDto extends createZodDto(createPqrSchema) {}
export class PqrCommentDto extends createZodDto(pqrCommentSchema) {}
export class UpdatePqrDto extends createZodDto(updatePqrSchema) {}
export class ListPqrQueryDto extends createZodDto(listPqrQuerySchema) {}
export class PqrReportQueryDto extends createZodDto(pqrReportQuerySchema) {}
