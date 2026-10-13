'use client';

import {
  type Paginated,
  RELATIONSHIP_LABELS,
  RELATIONSHIP_TYPES,
  type ResidentListItem,
  type TowerSummary,
} from '@brisas/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, SearchX, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AccessBadge } from '@/components/resident-bits';
import { useTenant } from '@/components/tenant-context';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { initials } from '@/lib/forms';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Residentes actuales' },
  { value: 'former', label: 'Antiguos residentes' },
  { value: 'all', label: 'Todos' },
] as const;

function ResidentsList() {
  const tenant = useTenant();
  const router = useRouter();
  const params = useSearchParams();

  // Los filtros viven en la URL: se pueden compartir y sobreviven a recargar la página.
  const filters = {
    search: params.get('buscar') ?? '',
    towerId: params.get('torre') ?? '',
    relationship: params.get('vinculacion') ?? '',
    status: params.get('estado') ?? 'active',
    page: Number(params.get('pagina') ?? '1') || 1,
  };
  const setFilters = (changes: Record<string, string | number>) => {
    const next = new URLSearchParams(params);
    if (!('pagina' in changes)) next.delete('pagina');
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 'active' || value === 1) next.delete(key);
      else next.set(key, String(value));
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  // La búsqueda espera a que la persona deje de escribir.
  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ buscar: searchText }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const towers = useQuery({
    queryKey: [tenant.tenantId, 'towers'],
    queryFn: () => api<TowerSummary[]>(`${tenant.apiPath}/towers`),
    enabled: tenant.can('properties.read'),
  });
  const residents = useQuery({
    queryKey: [tenant.tenantId, 'residents', filters],
    queryFn: () =>
      api<Paginated<ResidentListItem>>(`${tenant.apiPath}/residents`, {
        query: { ...filters, pageSize: 20 },
      }),
    placeholderData: keepPreviousData,
  });

  const hasFilters = Boolean(filters.search || filters.towerId || filters.relationship || filters.status !== 'active');
  const data = residents.data;

  return (
    <>
      <PageHeader
        title="Residentes"
        description="Personas vinculadas a las unidades del conjunto."
        actions={
          tenant.can('residents.manage') && (
            <Link href={`${tenant.path}/residentes/nuevo`} className={buttonClass('primary')}>
              <UserPlus className="size-4" aria-hidden /> Registrar residente
            </Link>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar por nombre, correo, documento o celular"
            aria-label="Buscar residentes"
            className="pl-9"
          />
        </div>
        {(towers.data?.length ?? 0) > 0 && (
          <Select aria-label="Filtrar por torre" value={filters.towerId} onChange={(event) => setFilters({ torre: event.target.value })}>
            <option value="">Todas las torres</option>
            {towers.data!.map((tower) => (
              <option key={tower.id} value={tower.id}>
                {tower.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Filtrar por tipo de vinculación"
          value={filters.relationship}
          onChange={(event) => setFilters({ vinculacion: event.target.value })}
        >
          <option value="">Cualquier vinculación</option>
          {RELATIONSHIP_TYPES.map((type) => (
            <option key={type} value={type}>
              {RELATIONSHIP_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select aria-label="Filtrar por estado" value={filters.status} onChange={(event) => setFilters({ estado: event.target.value })}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        {residents.isPending ? (
          <ul aria-hidden className="divide-y divide-line">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="flex items-center gap-4 p-4">
                <Skeleton className="size-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </li>
            ))}
          </ul>
        ) : residents.isError ? (
          <EmptyState
            icon={SearchX}
            title="No pudimos cargar los residentes"
            description="Revisa tu conexión e inténtalo de nuevo."
            action={<Button onClick={() => void residents.refetch()}>Reintentar</Button>}
          />
        ) : data && data.items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="Nadie coincide con la búsqueda"
              description="Prueba con otro nombre o quita los filtros para ver a todos los residentes."
              action={
                <Button variant="secondary" onClick={() => router.replace('?', { scroll: false })}>
                  Quitar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="Aún no hay residentes registrados"
              description="Registra al primero con el asistente: solo toma un par de minutos."
              action={
                tenant.can('residents.manage') && (
                  <Link href={`${tenant.path}/residentes/nuevo`} className={buttonClass('primary')}>
                    Registrar residente
                  </Link>
                )
              }
            />
          )
        ) : (
          <ul className={`divide-y divide-line ${residents.isPlaceholderData ? 'opacity-60' : ''}`}>
            {data?.items.map((resident) => (
              <li key={resident.personId}>
                <Link
                  href={`${tenant.path}/residentes/${resident.personId}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition hover:bg-surface-2"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-sm font-semibold text-brand-ink">
                    {initials(`${resident.firstName} ${resident.lastName}`)}
                  </span>
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block truncate font-medium">
                      {resident.firstName} {resident.lastName}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {[resident.email, resident.phone].filter(Boolean).join(' / ') || 'Sin datos de contacto'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {resident.occupancies.map((occupancy) => (
                      <Badge key={occupancy.id} tone="brand">
                        {occupancy.propertyLabel}, {RELATIONSHIP_LABELS[occupancy.relationship].toLowerCase()}
                      </Badge>
                    ))}
                    {resident.occupancies.length === 0 && <Badge>Sin vinculación vigente</Badge>}
                    <AccessBadge status={resident.accessStatus} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.total > 0 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <p>
            {data.total === 1 ? '1 persona' : `${data.total} personas`}
            {data.totalPages > 1 && `, página ${data.page} de ${data.totalPages}`}
          </p>
          {data.totalPages > 1 && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={data.page <= 1} onClick={() => setFilters({ pagina: data.page - 1 })}>
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters({ pagina: data.page + 1 })}
              >
                Siguiente <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        </nav>
      )}
    </>
  );
}

export default function ResidentsPage() {
  return (
    <Suspense>
      <ResidentsList />
    </Suspense>
  );
}
