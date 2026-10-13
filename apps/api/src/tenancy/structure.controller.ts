import type { GeneratePropertiesResult, Paginated, PropertySummary, TowerSummary } from '@brisas/contracts';
import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentTenant, Meta, RequirePermissions, TenantController } from '../auth/decorators';
import type { RequestMeta, TenantContext } from '../common/request-context';
import {
  GeneratePropertiesDto,
  ListPropertiesQueryDto,
  PropertyDto,
  TowerDto,
  UpdatePropertyDto,
} from './structure.dto';
import { StructureService } from './structure.service';

@TenantController('', 'Torres y unidades')
export class StructureController {
  constructor(private readonly service: StructureService) {}

  @Get('towers')
  @RequirePermissions('properties.read')
  @ApiOperation({ summary: 'Listar torres y bloques con su número de unidades' })
  listTowers(@CurrentTenant() tenant: TenantContext): Promise<TowerSummary[]> {
    return this.service.listTowers(tenant);
  }

  @Post('towers')
  @RequirePermissions('properties.manage')
  @ApiOperation({ summary: 'Crear una torre o bloque' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_TOWER' })
  createTower(@CurrentTenant() tenant: TenantContext, @Body() body: TowerDto, @Meta() meta: RequestMeta): Promise<TowerSummary> {
    return this.service.createTower(tenant, body, meta);
  }

  @Put('towers/:towerId')
  @HttpCode(204)
  @RequirePermissions('properties.manage')
  @ApiOperation({ summary: 'Actualizar una torre o bloque' })
  async updateTower(
    @CurrentTenant() tenant: TenantContext,
    @Param('towerId', ParseUUIDPipe) towerId: string,
    @Body() body: TowerDto,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.updateTower(tenant, towerId, body, meta);
  }

  @Delete('towers/:towerId')
  @HttpCode(204)
  @RequirePermissions('properties.manage')
  @ApiOperation({ summary: 'Eliminar una torre sin unidades' })
  @ApiResponse({ status: 409, description: 'TOWER_HAS_UNITS' })
  async deleteTower(
    @CurrentTenant() tenant: TenantContext,
    @Param('towerId', ParseUUIDPipe) towerId: string,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.deleteTower(tenant, towerId, meta);
  }

  @Get('properties')
  @RequirePermissions('properties.read')
  @ApiOperation({ summary: 'Listar unidades', description: 'Filtros por torre, número y ocupación. Paginado.' })
  listProperties(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListPropertiesQueryDto,
  ): Promise<Paginated<PropertySummary>> {
    return this.service.listProperties(tenant, query);
  }

  @Post('properties')
  @RequirePermissions('properties.manage')
  @ApiOperation({ summary: 'Crear una unidad' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_PROPERTY' })
  @ApiResponse({ status: 422, description: 'PLAN_LIMIT_REACHED o TOWER_NOT_FOUND' })
  createProperty(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: PropertyDto,
    @Meta() meta: RequestMeta,
  ): Promise<PropertySummary> {
    return this.service.createProperty(tenant, body, meta);
  }

  @Post('properties/generate')
  @HttpCode(200)
  @RequirePermissions('properties.manage')
  @ApiOperation({
    summary: 'Generar en bloque las unidades de una torre',
    description: 'Numera como <piso><consecutivo>: 101, 102… Es idempotente: omite las unidades que ya existen.',
  })
  generateProperties(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: GeneratePropertiesDto,
    @Meta() meta: RequestMeta,
  ): Promise<GeneratePropertiesResult> {
    return this.service.generateProperties(tenant, body, meta);
  }

  @Patch('properties/:propertyId')
  @RequirePermissions('properties.manage')
  @ApiOperation({ summary: 'Actualizar o desactivar una unidad' })
  @ApiResponse({ status: 409, description: 'PROPERTY_OCCUPIED o DUPLICATE_PROPERTY' })
  updateProperty(
    @CurrentTenant() tenant: TenantContext,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: UpdatePropertyDto,
    @Meta() meta: RequestMeta,
  ): Promise<PropertySummary> {
    return this.service.updateProperty(tenant, propertyId, body, meta);
  }
}
