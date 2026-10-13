import type {
  AccessStatus,
  CreateResidentResponse,
  DuplicateCheckResponse,
  Paginated,
  ResidentDetail,
  ResidentListItem,
} from '@brisas/contracts';
import { Body, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentTenant, Meta, RequirePermissions, TenantController } from '../auth/decorators';
import type { RequestMeta, TenantContext } from '../common/request-context';
import {
  CheckDuplicateQueryDto,
  CreateResidentDto,
  EndOccupancyDto,
  ListResidentsQueryDto,
  SetResidentAccessDto,
  UpdateResidentDto,
} from './residents.dto';
import { ResidentsService } from './residents.service';

@TenantController('residents', 'Residentes')
export class ResidentsController {
  constructor(private readonly service: ResidentsService) {}

  @Get()
  @RequirePermissions('residents.read')
  @ApiOperation({
    summary: 'Listar residentes',
    description: 'Búsqueda por nombre, correo, documento o celular. Filtros por torre, unidad y tipo de vinculación.',
  })
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListResidentsQueryDto): Promise<Paginated<ResidentListItem>> {
    return this.service.list(tenant, query);
  }

  @Get('duplicates')
  @RequirePermissions('residents.manage')
  @ApiOperation({ summary: 'Buscar personas ya registradas con el mismo correo o documento' })
  async duplicates(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: CheckDuplicateQueryDto,
  ): Promise<DuplicateCheckResponse> {
    return { matches: await this.service.checkDuplicates(tenant, query) };
  }

  @Post()
  @RequirePermissions('residents.manage')
  @ApiOperation({
    summary: 'Registrar un residente (asistente completo)',
    description:
      'Crea la persona (o vincula una existente), su vinculación con la unidad, parqueaderos, depósitos y mascotas ' +
      'en una sola transacción. Con `sendInvitation` crea la cuenta de acceso y envía la invitación.',
  })
  @ApiResponse({ status: 409, description: 'DUPLICATE_PERSON, OCCUPANCY_EXISTS o ASSET_ALREADY_ASSIGNED' })
  @ApiResponse({ status: 422, description: 'PROPERTY_NOT_FOUND o EMAIL_REQUIRED' })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: CreateResidentDto,
    @Meta() meta: RequestMeta,
  ): Promise<CreateResidentResponse> {
    return this.service.create(tenant, body, meta);
  }

  @Get(':personId')
  @RequirePermissions('residents.read')
  @ApiOperation({ summary: 'Detalle del residente: vinculaciones, bienes, mascotas e historial de cambios' })
  get(@CurrentTenant() tenant: TenantContext, @Param('personId', ParseUUIDPipe) personId: string): Promise<ResidentDetail> {
    return this.service.get(tenant, personId);
  }

  @Put(':personId')
  @HttpCode(204)
  @RequirePermissions('residents.manage')
  @ApiOperation({ summary: 'Editar los datos personales' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_PERSON' })
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: UpdateResidentDto,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.update(tenant, personId, body, meta);
  }

  @Put(':personId/access')
  @HttpCode(200)
  @RequirePermissions('residents.manage')
  @ApiOperation({
    summary: 'Activar o desactivar el acceso al portal',
    description: 'Al activar por primera vez se envía la invitación al correo de la persona.',
  })
  setAccess(
    @CurrentTenant() tenant: TenantContext,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: SetResidentAccessDto,
    @Meta() meta: RequestMeta,
  ): Promise<{ accessStatus: AccessStatus; invitationSent: boolean }> {
    return this.service.setAccess(tenant, personId, body.enabled, meta);
  }

  @Post(':personId/occupancies/:occupancyId/end')
  @HttpCode(204)
  @RequirePermissions('residents.manage')
  @ApiOperation({
    summary: 'Terminar una vinculación',
    description: 'Conserva la fila como historial de ocupación. Si era la última vigente, suspende el acceso al portal.',
  })
  async endOccupancy(
    @CurrentTenant() tenant: TenantContext,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Param('occupancyId', ParseUUIDPipe) occupancyId: string,
    @Body() body: EndOccupancyDto,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    await this.service.endOccupancy(tenant, personId, occupancyId, body.endDate, meta);
  }
}
