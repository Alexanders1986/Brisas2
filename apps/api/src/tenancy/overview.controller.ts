import type { TenantBranding, TenantDashboard } from '@brisas/contracts';
import { tenantSettings, tenants } from '@brisas/database';
import { Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { eq, sql } from 'drizzle-orm';
import { AnyMember, CurrentTenant, RequirePermissions, TenantController } from '../auth/decorators';
import { AppError } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';

@TenantController('', 'Conjunto')
export class OverviewController {
  constructor(private readonly database: DatabaseService) {}

  @Get('branding')
  @AnyMember()
  @ApiOperation({
    summary: 'Identidad e información institucional del conjunto',
    description: 'Disponible para cualquier miembro activo. Alimenta el encabezado y la pantalla de inicio.',
  })
  async branding(@CurrentTenant() tenant: TenantContext): Promise<TenantBranding> {
    return this.database.tenant(tenant, async (tx) => {
      // Sin filtro por tenant a propósito: RLS garantiza que solo existe una fila visible.
      const [row] = await tx
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          primaryColor: tenantSettings.primaryColor,
          welcomeMessage: tenantSettings.welcomeMessage,
          address: tenantSettings.address,
          city: tenantSettings.city,
          phones: tenantSettings.phones,
          whatsapp: tenantSettings.whatsapp,
          email: tenantSettings.email,
          website: tenantSettings.website,
          officeHours: tenantSettings.officeHours,
        })
        .from(tenants)
        .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
        .where(eq(tenants.id, tenant.tenantId));
      if (!row) throw AppError.notFound('No encontramos el conjunto.');
      return { ...row, phones: row.phones ?? [] };
    });
  }

  @Get('dashboard')
  @RequirePermissions('dashboard.read')
  @ApiOperation({
    summary: 'Indicadores del panel administrativo',
    description:
      'Residentes activos = personas con al menos una vinculación vigente. Unidades ocupadas = unidades activas con al menos una vinculación vigente.',
  })
  async dashboard(@CurrentTenant() tenant: TenantContext): Promise<TenantDashboard> {
    return this.database.tenant(tenant, async (tx) => {
      const result = await tx.execute<TenantDashboard & Record<string, unknown>>(sql`
        SELECT
          (SELECT count(DISTINCT person_id)::int FROM property_occupancies WHERE end_date IS NULL) AS "activeResidents",
          (SELECT count(*)::int FROM properties WHERE is_active) AS "units",
          (SELECT count(*)::int FROM properties p WHERE p.is_active AND EXISTS (
             SELECT 1 FROM property_occupancies o WHERE o.property_id = p.id AND o.end_date IS NULL)) AS "occupiedUnits",
          (SELECT count(*)::int FROM towers) AS "towers",
          (SELECT count(*)::int FROM pets WHERE is_active) AS "pets",
          (SELECT count(*)::int FROM parking_spaces) AS "parkingSpaces",
          (SELECT count(*)::int FROM persons pe JOIN users u ON u.id = pe.user_id
            WHERE pe.deleted_at IS NULL AND u.status = 'active') AS "residentsWithAccess",
          (SELECT count(*)::int FROM persons pe JOIN users u ON u.id = pe.user_id
            WHERE pe.deleted_at IS NULL AND u.status = 'invited') AS "pendingInvitations",
          (SELECT count(*)::int FROM pqrs WHERE status = 'pending_review') AS "pqrPendingReview",
          (SELECT count(*)::int FROM pqrs WHERE status = 'in_progress') AS "pqrInProgress"
      `);
      // Las subconsultas no filtran por conjunto: lo hace Row Level Security.
      const data = result.rows[0]!;
      // Los conteos de PQR solo se entregan a quien puede ver las PQR del conjunto.
      return tenant.permissions.has('pqr.read_all') ? data : { ...data, pqrPendingReview: null, pqrInProgress: null };
    });
  }
}
