'use client';

import type { MembershipSummary, PermissionKey } from '@brisas/contracts';
import { createContext, useContext } from 'react';

export interface TenantValue {
  membership: MembershipSummary;
  tenantId: string;
  /** Ruta base en la web: /c/<slug> */
  path: string;
  /** Ruta base en la API: /tenants/<id> */
  apiPath: string;
  /** Solo decide qué mostrar; la API vuelve a validar cada permiso. */
  can: (permission: PermissionKey) => boolean;
}

export const TenantContext = createContext<TenantValue | null>(null);

export function useTenant(): TenantValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error('useTenant debe usarse dentro de /c/[slug]');
  return value;
}
