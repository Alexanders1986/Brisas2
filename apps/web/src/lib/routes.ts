import type { MeResponse } from '@brisas/contracts';

/** A dónde llevar a una persona después de iniciar sesión. */
export function homeFor(me: MeResponse): string {
  if (me.memberships.length === 1 && !me.isPlatformAdmin) return `/c/${me.memberships[0]!.tenantSlug}`;
  if (me.memberships.length === 0 && me.isPlatformAdmin) return '/plataforma';
  return '/conjuntos';
}
