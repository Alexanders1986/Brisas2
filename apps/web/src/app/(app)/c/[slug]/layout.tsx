'use client';

import { ROLE_LABELS } from '@brisas/contracts';
import { Building2, ChartNoAxesColumn, DoorOpen, House, MessagesSquare, Users, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { useSession } from '@/components/providers';
import { type NavItem, Shell } from '@/components/shell';
import { TenantContext, type TenantValue } from '@/components/tenant-context';
import { EmptyState, buttonClass } from '@/components/ui';

export default function TenantLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { me } = useSession();
  const membership = me?.memberships.find((item) => item.tenantSlug === slug);

  const value = useMemo<TenantValue | null>(() => {
    if (!membership) return null;
    const permissions = new Set(membership.permissions);
    return {
      membership,
      tenantId: membership.tenantId,
      path: `/c/${membership.tenantSlug}`,
      apiPath: `/tenants/${membership.tenantId}`,
      can: (permission) => permissions.has(permission),
    };
  }, [membership]);

  if (!value || !membership) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EmptyState
          icon={DoorOpen}
          title="No tienes acceso a este conjunto"
          description="Puede que el enlace esté mal escrito o que la administración haya desactivado tu acceso."
          action={
            <Link href="/conjuntos" className={buttonClass('primary')}>
              Ver mis conjuntos
            </Link>
          }
        />
      </div>
    );
  }

  // El menú solo muestra lo que el rol puede usar y lo que ya está construido.
  const nav: NavItem[] = [{ href: value.path, label: 'Inicio', icon: House, exact: true }];
  if (value.can('pqr.read_all')) nav.push({ href: `${value.path}/pqr`, label: 'PQR', icon: MessagesSquare });
  else if (value.can('pqr.read_own')) nav.push({ href: `${value.path}/pqr`, label: 'Mis solicitudes', icon: MessagesSquare });
  // "Mi hogar" es para quien vive en el conjunto; el personal gestiona hogares desde Residentes.
  if (value.can('household.manage_own') && !value.can('residents.read')) {
    nav.push({ href: `${value.path}/hogar`, label: 'Mi hogar', icon: UsersRound });
  }
  if (value.can('residents.read')) nav.push({ href: `${value.path}/residentes`, label: 'Residentes', icon: Users });
  if (value.can('properties.read')) nav.push({ href: `${value.path}/unidades`, label: 'Torres y unidades', icon: Building2 });
  if (value.can('reports.read')) nav.push({ href: `${value.path}/reportes`, label: 'Reportes', icon: ChartNoAxesColumn });

  return (
    <TenantContext.Provider value={value}>
      <Shell
        title={membership.tenantName}
        subtitle={membership.roles.map((role) => ROLE_LABELS[role]).join(', ')}
        brandColor={membership.primaryColor}
        nav={nav}
        search={
          value.can('residents.read')
            ? {
                placeholder: 'Buscar residente por nombre, correo o documento',
                onSearch: (text) => router.push(`${value.path}/residentes?buscar=${encodeURIComponent(text)}`),
              }
            : undefined
        }
      >
        {children}
      </Shell>
    </TenantContext.Provider>
  );
}
