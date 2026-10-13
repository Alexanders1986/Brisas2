import {
  type MembershipSummary,
  type PermissionKey,
  type RoleKey,
  STAFF_ROLES,
} from '@brisas/contracts';
import { rolePermissions, roles, tenantSettings, tenants, userTenantMemberships } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../database/database.service';

export interface TenantAccess {
  tenantStatus: 'active' | 'suspended';
  roles: RoleKey[];
  permissions: Set<PermissionKey>;
}

@Injectable()
export class AccessService {
  /** Conjuntos a los que pertenece el usuario, con la unión de permisos de sus roles activos. */
  async memberships(tx: Tx, userId: string): Promise<MembershipSummary[]> {
    const rows = await tx
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
        primaryColor: tenantSettings.primaryColor,
        roleKey: roles.key,
        permissionKey: rolePermissions.permissionKey,
      })
      .from(userTenantMemberships)
      .innerJoin(tenants, eq(tenants.id, userTenantMemberships.tenantId))
      .innerJoin(roles, eq(roles.id, userTenantMemberships.roleId))
      .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(userTenantMemberships.userId, userId), eq(userTenantMemberships.status, 'active')))
      .orderBy(tenants.name);

    const byTenant = new Map<string, MembershipSummary & { roleSet: Set<string>; permissionSet: Set<string> }>();
    for (const row of rows) {
      let entry = byTenant.get(row.tenantId);
      if (!entry) {
        entry = {
          tenantId: row.tenantId,
          tenantSlug: row.tenantSlug,
          tenantName: row.tenantName,
          tenantStatus: row.tenantStatus,
          primaryColor: row.primaryColor,
          roles: [],
          permissions: [],
          roleSet: new Set(),
          permissionSet: new Set(),
        };
        byTenant.set(row.tenantId, entry);
      }
      entry.roleSet.add(row.roleKey);
      if (row.permissionKey) entry.permissionSet.add(row.permissionKey);
    }
    return [...byTenant.values()].map(({ roleSet, permissionSet, ...summary }) => ({
      ...summary,
      roles: [...roleSet] as RoleKey[],
      permissions: [...permissionSet].sort() as PermissionKey[],
    }));
  }

  /** Acceso del usuario a un conjunto concreto; null si no es miembro activo. */
  async tenantAccess(tx: Tx, userId: string, tenantId: string): Promise<TenantAccess | null> {
    const membership = (await this.memberships(tx, userId)).find((item) => item.tenantId === tenantId);
    if (!membership) return null;
    return {
      tenantStatus: membership.tenantStatus,
      roles: membership.roles,
      permissions: new Set(membership.permissions),
    };
  }

  static hasStaffRole(roleKeys: readonly RoleKey[]): boolean {
    return roleKeys.some((role) => STAFF_ROLES.includes(role));
  }
}
