'use client';

import type { Paginated, PropertySummary, TenantBranding, TenantDashboard, TowerSummary } from '@brisas/contracts';
import { useQuery } from '@tanstack/react-query';
import { Building2, Clock, Mail, MapPin, MessageCircle, PawPrint, Phone, SquareParking, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Facade, FacadeLegend } from '@/components/facade';
import { useSession } from '@/components/providers';
import { useTenant } from '@/components/tenant-context';
import { Card, EmptyState, PageHeader, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { groupByTower } from '@/lib/units';

export default function TenantHomePage() {
  const tenant = useTenant();
  return tenant.can('dashboard.read') ? <AdminDashboard /> : <ResidentHome />;
}

// ------------------------------------------------------------ administración

function AdminDashboard() {
  const tenant = useTenant();
  const { me } = useSession();
  const dashboard = useQuery({
    queryKey: [tenant.tenantId, 'dashboard'],
    queryFn: () => api<TenantDashboard>(`${tenant.apiPath}/dashboard`),
  });
  const canSeeUnits = tenant.can('properties.read');
  const towers = useQuery({
    queryKey: [tenant.tenantId, 'towers'],
    queryFn: () => api<TowerSummary[]>(`${tenant.apiPath}/towers`),
    enabled: canSeeUnits,
  });
  const units = useQuery({
    queryKey: [tenant.tenantId, 'properties', 'all'],
    queryFn: () => api<Paginated<PropertySummary>>(`${tenant.apiPath}/properties`, { query: { pageSize: 500 } }),
    enabled: canSeeUnits,
  });

  const data = dashboard.data;
  const occupancy = data && data.units > 0 ? Math.round((data.occupiedUnits / data.units) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`Hola, ${me?.displayName.split(' ')[0] ?? ''}`}
        description="Así está tu conjunto hoy."
        actions={
          tenant.can('residents.manage') && (
            <Link href={`${tenant.path}/residentes/nuevo`} className={buttonClass('primary')}>
              <UserPlus className="size-4" aria-hidden /> Registrar residente
            </Link>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="flex flex-col justify-between p-6">
          <div>
            <p className="font-medium text-muted">Unidades ocupadas</p>
            {data ? (
              <p className="mt-1 font-display text-5xl font-semibold tabular-nums">
                {data.occupiedUnits}
                <span className="text-2xl font-medium text-muted"> de {data.units}</span>
              </p>
            ) : (
              <Skeleton className="mt-2 h-12 w-40" />
            )}
          </div>
          <div className="mt-6">
            <div
              role="progressbar"
              aria-label="Porcentaje de unidades ocupadas"
              aria-valuenow={occupancy}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 overflow-hidden rounded-full bg-surface-2"
            >
              <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${occupancy}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">{data ? `${occupancy}% de ocupación` : ' '}</p>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Stat label="Residentes activos" value={data?.activeResidents} href={`${tenant.path}/residentes`} />
          <Stat label="Con acceso al portal" value={data?.residentsWithAccess} hint={data ? invitationHint(data.pendingInvitations) : undefined} />
          <Stat label="Parqueaderos" value={data?.parkingSpaces} icon={SquareParking} />
          <Stat label="Mascotas" value={data?.pets} icon={PawPrint} />
        </div>
      </div>

      {canSeeUnits && (
        <Card className="mt-4 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">El conjunto de un vistazo</h2>
            <FacadeLegend />
          </div>
          {units.isPending || towers.isPending ? (
            <Skeleton className="h-48" />
          ) : units.data && units.data.items.length > 0 ? (
            <div className="flex flex-wrap gap-x-10 gap-y-8">
              {groupByTower(units.data.items, towers.data ?? []).filter((group) => group.units.length > 0).map((group) => (
                <div key={group.name}>
                  <h3 className="mb-3 font-display font-semibold">{group.name}</h3>
                  <Facade units={group.units} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title="Aún no hay unidades"
              description="Crea las torres y genera sus apartamentos para empezar a registrar residentes."
              action={
                tenant.can('properties.manage') && (
                  <Link href={`${tenant.path}/unidades`} className={buttonClass('primary')}>
                    Crear torres y unidades
                  </Link>
                )
              }
            />
          )}
        </Card>
      )}
    </>
  );
}

function invitationHint(pending: number): string | undefined {
  if (pending === 0) return undefined;
  return pending === 1 ? '1 invitación sin aceptar' : `${pending} invitaciones sin aceptar`;
}

function Stat({
  label,
  value,
  hint,
  href,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  href?: string;
  icon?: typeof PawPrint;
}) {
  const content = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {Icon && <Icon className="size-4" aria-hidden />}
        {label}
      </p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-14" />
      ) : (
        <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="mt-1 text-sm text-warn">{hint}</p>}
    </>
  );
  const className = 'rounded-(--radius-card) border border-line bg-surface p-5';
  return href ? (
    <Link href={href} className={`${className} transition hover:border-brand`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

// ------------------------------------------------------------------ residente

function ResidentHome() {
  const tenant = useTenant();
  const { me } = useSession();
  const branding = useQuery({
    queryKey: [tenant.tenantId, 'branding'],
    queryFn: () => api<TenantBranding>(`${tenant.apiPath}/branding`),
  });
  const info = branding.data;

  return (
    <>
      <section className="rounded-(--radius-card) bg-brand px-6 py-10 text-on-brand sm:px-10">
        <p className="font-medium opacity-85">{tenant.membership.tenantName}</p>
        <h1 className="mt-1 text-[34px] font-semibold leading-tight">Hola, {me?.displayName.split(' ')[0]}</h1>
        <p className="mt-2 max-w-xl text-lg opacity-90">{info?.welcomeMessage ?? 'Te damos la bienvenida a tu conjunto.'}</p>
      </section>

      <Card className="mt-4 p-6">
        <h2 className="text-xl font-semibold">Administración</h2>
        {branding.isPending ? (
          <Skeleton className="mt-4 h-28" />
        ) : info ? (
          <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Contact icon={Clock} label="Horario de atención" value={info.officeHours} />
            <Contact icon={MapPin} label="Dirección" value={[info.address, info.city].filter(Boolean).join(', ') || null} />
            <Contact icon={Phone} label="Teléfono" value={info.phones.join(' / ') || null} href={info.phones[0] ? `tel:${info.phones[0].replace(/\s/g, '')}` : undefined} />
            <Contact
              icon={MessageCircle}
              label="WhatsApp"
              value={info.whatsapp}
              href={info.whatsapp ? `https://wa.me/${info.whatsapp.replace(/\D/g, '')}` : undefined}
            />
            <Contact icon={Mail} label="Correo" value={info.email} href={info.email ? `mailto:${info.email}` : undefined} />
          </dl>
        ) : null}
      </Card>

      <p className="mt-6 text-sm text-muted">
        Pronto encontrarás aquí los comunicados, los documentos del conjunto, tus solicitudes y el pago de administración.
      </p>
    </>
  );
}

function Contact({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Clock;
  label: string;
  value: string | null;
  href?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="font-medium">
          {href ? (
            <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="hover:underline">
              {value}
            </a>
          ) : (
            value
          )}
        </dd>
      </div>
    </div>
  );
}
