import type { HouseholdMember, HouseholdPet, MyHouseholdResponse, PropertyHousehold, Vehicle } from '@brisas/contracts';
import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AnyMember, CurrentTenant, Meta, RequirePermissions, TenantController } from '../auth/decorators';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { HouseholdMemberDto, HouseholdPetDto, VehicleDto } from './household.dto';
import { HouseholdService } from './household.service';

const WHO =
  'Pueden hacerlo los residentes con vinculación vigente en la unidad y el personal con permiso para gestionar residentes.';

/**
 * Las rutas por unidad usan @AnyMember porque el permiso depende del recurso: el servicio
 * verifica que quien llama viva en esa unidad o sea personal autorizado.
 */
@TenantController('', 'Hogar y vehículos')
export class HouseholdController {
  constructor(private readonly service: HouseholdService) {}

  @Get('my/household')
  @RequirePermissions('household.manage_own')
  @ApiOperation({ summary: 'Mis unidades con las personas y los vehículos registrados en cada una' })
  mine(@CurrentTenant() tenant: TenantContext): Promise<MyHouseholdResponse> {
    return this.service.mine(tenant);
  }

  @Get('properties/:propertyId/household')
  @AnyMember()
  @ApiOperation({ summary: 'Personas y vehículos de una unidad', description: WHO })
  get(@CurrentTenant() tenant: TenantContext, @Param('propertyId', ParseUUIDPipe) propertyId: string): Promise<PropertyHousehold> {
    return this.service.get(tenant, propertyId);
  }

  @Post('properties/:propertyId/household-members')
  @AnyMember()
  @ApiOperation({ summary: 'Agregar una persona que vive en la unidad', description: WHO })
  addMember(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: HouseholdMemberDto,
    @Meta() meta: RequestMeta,
  ): Promise<HouseholdMember> {
    return this.service.addMember(tenant, propertyId, body, meta);
  }

  @Put('properties/:propertyId/household-members/:memberId')
  @AnyMember()
  @ApiOperation({ summary: 'Editar una persona del hogar', description: WHO })
  updateMember(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: HouseholdMemberDto,
    @Meta() meta: RequestMeta,
  ): Promise<HouseholdMember> {
    return this.service.updateMember(tenant, propertyId, memberId, body, meta);
  }

  @Delete('properties/:propertyId/household-members/:memberId')
  @HttpCode(204)
  @AnyMember()
  @ApiOperation({ summary: 'Quitar una persona del hogar', description: WHO })
  async removeMember(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.removeMember(tenant, propertyId, memberId, meta);
  }

  @Post('properties/:propertyId/vehicles')
  @AnyMember()
  @ApiOperation({ summary: 'Registrar un vehículo de la unidad', description: WHO })
  addVehicle(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: VehicleDto,
    @Meta() meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.service.addVehicle(tenant, propertyId, body, meta);
  }

  @Put('properties/:propertyId/vehicles/:vehicleId')
  @AnyMember()
  @ApiOperation({ summary: 'Editar un vehículo', description: WHO })
  updateVehicle(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() body: VehicleDto,
    @Meta() meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.service.updateVehicle(tenant, propertyId, vehicleId, body, meta);
  }

  @Post('properties/:propertyId/pets')
  @AnyMember()
  @ApiOperation({ summary: 'Registrar una mascota de la unidad', description: WHO })
  addPet(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: HouseholdPetDto,
    @Meta() meta: RequestMeta,
  ): Promise<HouseholdPet> {
    return this.service.addPet(tenant, propertyId, body, meta);
  }

  @Put('properties/:propertyId/pets/:petId')
  @AnyMember()
  @ApiOperation({ summary: 'Editar una mascota', description: WHO })
  updatePet(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() body: HouseholdPetDto,
    @Meta() meta: RequestMeta,
  ): Promise<HouseholdPet> {
    return this.service.updatePet(tenant, propertyId, petId, body, meta);
  }

  @Delete('properties/:propertyId/pets/:petId')
  @HttpCode(204)
  @AnyMember()
  @ApiOperation({ summary: 'Quitar una mascota', description: WHO })
  async removePet(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.removePet(tenant, propertyId, petId, meta);
  }

  @Delete('properties/:propertyId/vehicles/:vehicleId')
  @HttpCode(204)
  @AnyMember()
  @ApiOperation({ summary: 'Quitar un vehículo', description: WHO })
  async removeVehicle(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.removeVehicle(tenant, propertyId, vehicleId, meta);
  }
}
