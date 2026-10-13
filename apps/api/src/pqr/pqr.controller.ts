import type { Paginated, PqrAssignee, PqrDetail, PqrListItem, PqrReport } from '@brisas/contracts';
import { Body, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnyMember, CurrentTenant, Meta, RequirePermissions, TenantController } from '../auth/decorators';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { CreatePqrDto, ListPqrQueryDto, PqrCommentDto, PqrReportQueryDto, UpdatePqrDto } from './pqr.dto';
import { PqrService } from './pqr.service';

/**
 * Varias rutas usan @AnyMember porque el acceso depende de la solicitud: el servicio
 * decide si quien llama la radicó, la tiene asignada o gestiona todas.
 */
@TenantController('', 'PQR')
export class PqrController {
  constructor(private readonly service: PqrService) {}

  @Get('pqrs')
  @AnyMember()
  @ApiOperation({
    summary: 'Listar PQR',
    description:
      'Con `pqr.read_all` devuelve todas las del conjunto; con `pqr.read_own`, solo las que radicó quien consulta. ' +
      'Filtros por estado, tipo, prioridad, torre, fechas de radicación y búsqueda por radicado, asunto o solicitante.',
  })
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListPqrQueryDto): Promise<Paginated<PqrListItem>> {
    return this.service.list(tenant, query);
  }

  @Post('pqrs')
  @RequirePermissions('pqr.create')
  @ApiOperation({
    summary: 'Radicar una PQR',
    description: 'Genera el número de radicado (PQR-AAAA-NNNNNN) y envía la confirmación por correo.',
  })
  @ApiResponse({ status: 422, description: 'PROPERTY_NOT_YOURS' })
  create(@CurrentTenant() tenant: TenantContext, @Body() body: CreatePqrDto, @Meta() meta: RequestMeta): Promise<PqrDetail> {
    return this.service.create(tenant, body, meta);
  }

  @Get('pqrs/assignees')
  @RequirePermissions('pqr.read_all')
  @ApiOperation({ summary: 'Personal al que se le puede asignar una PQR' })
  assignees(@CurrentTenant() tenant: TenantContext): Promise<PqrAssignee[]> {
    return this.service.assignees(tenant);
  }

  @Get('pqrs/:pqrId')
  @AnyMember()
  @ApiOperation({
    summary: 'Detalle de una PQR con su conversación e historial de estados',
    description: 'Las notas internas solo se incluyen para el personal.',
  })
  get(@CurrentTenant() tenant: TenantContext, @Param('pqrId', ParseUUIDPipe) pqrId: string): Promise<PqrDetail> {
    return this.service.get(tenant, pqrId);
  }

  @Post('pqrs/:pqrId/comments')
  @HttpCode(200)
  @AnyMember()
  @ApiOperation({
    summary: 'Escribir en la conversación',
    description:
      'Puede escribir quien radicó la solicitud y el personal que la gestiona. La primera respuesta del personal ' +
      'la pasa a "En trámite". `isInternal` crea una nota que el residente nunca ve.',
  })
  @ApiResponse({ status: 409, description: 'PQR_CLOSED' })
  comment(
    @CurrentTenant() tenant: TenantContext,
    @Param('pqrId', ParseUUIDPipe) pqrId: string,
    @Body() body: PqrCommentDto,
    @Meta() meta: RequestMeta,
  ): Promise<PqrDetail> {
    return this.service.comment(tenant, pqrId, body, meta);
  }

  @Patch('pqrs/:pqrId')
  @AnyMember()
  @ApiOperation({
    summary: 'Cambiar estado, prioridad o responsable',
    description: 'Requiere `pqr.manage`, o `pqr.manage_assigned` si la solicitud está asignada a quien llama.',
  })
  @ApiResponse({ status: 409, description: 'INVALID_STATUS_CHANGE' })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('pqrId', ParseUUIDPipe) pqrId: string,
    @Body() body: UpdatePqrDto,
    @Meta() meta: RequestMeta,
  ): Promise<PqrDetail> {
    return this.service.update(tenant, pqrId, body, meta);
  }

  @Get('reports/pqr')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'Indicadores de PQR de un periodo',
    description:
      'Todos los indicadores se calculan sobre las PQR radicadas entre `from` y `to` (zona horaria del conjunto). ' +
      'Los tiempos promedio son en horas calendario.',
  })
  report(@CurrentTenant() tenant: TenantContext, @Query() query: PqrReportQueryDto): Promise<PqrReport> {
    return this.service.report(tenant, query);
  }
}
