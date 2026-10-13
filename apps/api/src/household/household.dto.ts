import { householdMemberSchema, householdPetSchema, vehicleSchema } from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';

export class HouseholdMemberDto extends createZodDto(householdMemberSchema) {}
export class VehicleDto extends createZodDto(vehicleSchema) {}
export class HouseholdPetDto extends createZodDto(householdPetSchema) {}
