import type { Paginated, PlanSummary, PlatformMetrics, TenantSummary } from '@brisas/contracts';
import { Body, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Auth, Meta, PlatformController } from '../auth/decorators';
import type { AuthContext, RequestMeta } from '../common/request-context';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreateTenantDto, ListTenantsQueryDto, SetTenantStatusDto, UpdateTenantDto } from './platform.dto';

@PlatformController('', 'Plataforma (SuperAdmin)')
export class PlatformTenantsController {
  constructor(private readonly service: PlatformTenantsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Métricas globales de la plataforma' })
  metrics(@Auth() auth: AuthContext): Promise<PlatformMetrics> {
    return this.service.metrics(auth);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Planes de servicio disponibles' })
  plans(@Auth() auth: AuthContext): Promise<PlanSummary[]> {
    return this.service.plans(auth);
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Listar conjuntos residenciales', description: 'Paginado, con búsqueda por nombre, identificador o NIT.' })
  list(@Auth() auth: AuthContext, @Query() query: ListTenantsQueryDto): Promise<Paginated<TenantSummary>> {
    return this.service.list(auth, query);
  }

  @Post('tenants')
  @ApiOperation({
    summary: 'Crear un conjunto residencial',
    description: 'Crea el conjunto, sus categorías documentales por defecto e invita por correo a su primer administrador.',
  })
  @ApiResponse({ status: 409, description: 'SLUG_TAKEN' })
  create(@Auth() auth: AuthContext, @Body() body: CreateTenantDto, @Meta() meta: RequestMeta): Promise<TenantSummary> {
    return this.service.create(auth, body, meta);
  }

  @Get('tenants/:tenantId')
  @ApiOperation({ summary: 'Consultar un conjunto' })
  get(@Auth() auth: AuthContext, @Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<TenantSummary> {
    return this.service.get(auth, tenantId);
  }

  @Patch('tenants/:tenantId')
  @ApiOperation({ summary: 'Actualizar nombre, NIT o plan de un conjunto' })
  update(
    @Auth() auth: AuthContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: UpdateTenantDto,
    @Meta() meta: RequestMeta,
  ): Promise<TenantSummary> {
    return this.service.update(auth, tenantId, body, meta);
  }

  @Put('tenants/:tenantId/status')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activar o desactivar un conjunto',
    description: 'Un conjunto desactivado conserva sus datos, pero nadie puede operar sobre él.',
  })
  setStatus(
    @Auth() auth: AuthContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: SetTenantStatusDto,
    @Meta() meta: RequestMeta,
  ): Promise<TenantSummary> {
    return this.service.setStatus(auth, tenantId, body.status, meta);
  }
}
