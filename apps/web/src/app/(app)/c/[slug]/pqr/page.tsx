'use client';

import {
  PQR_PRIORITIES,
  PQR_PRIORITY_LABELS,
  PQR_STATUSES,
  PQR_STATUS_LABELS,
  PQR_TRANSITIONS,
  PQR_TYPES,
  PQR_TYPE_LABELS,
  type Paginated,
  type PqrListItem,
  type PqrStatus,
} from '@brisas/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Columns3, List, MessageSquarePlus, MessagesSquare, Search, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PqrPriorityBadge, PqrStatusBadge } from '@/components/pqr-bits';
import { useTenant } from '@/components/tenant-context';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, buttonClass, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/forms';

function PqrIndex() {
  const tenant = useTenant();
  const router = useRouter();
  const params = useSearchParams();
  const isStaff = tenant.can('pqr.read_all');
  const view = isStaff && params.get('vista') === 'tablero' ? 'board' : 'list';

  const filters = {
    search: params.get('buscar') ?? '',
    status: params.get('estado') ?? '',
    type: params.get('tipo') ?? '',
    priority: params.get('prioridad') ?? '',
    assignedToMe: params.get('mias') === '1',
    page: Number(params.get('pagina') ?? '1') || 1,
  };
  const setFilters = (changes: Record<string, string | number | boolean>) => {
    const next = new URLSearchParams(params);
    if (!('pagina' in changes)) next.delete('pagina');
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === false || value === 1) next.delete(key);
      else next.set(key, value === true ? '1' : String(value));
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ buscar: searchText }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const query = {
    search: filters.search,
    type: filters.type,
    priority: filters.priority,
    assignedToMe: filters.assignedToMe || undefined,
    // El tablero muestra todos los estados a la vez.
    ...(view === 'board' ? { pageSize: 200 } : { status: filters.status, page: filters.page, pageSize: 20 }),
  };
  const pqrs = useQuery({
    queryKey: [tenant.tenantId, 'pqrs', view, query],
    queryFn: () => api<Paginated<PqrListItem>>(`${tenant.apiPath}/pqrs`, { query }),
    placeholderData: keepPreviousData,
  });
  const data = pqrs.data;
  const hasFilters = Boolean(filters.search || filters.status || filters.type || filters.priority || filters.assignedToMe);

  return (
    <>
      <PageHeader
        title={isStaff ? 'PQR' : 'Mis solicitudes'}
        description={
          isStaff
            ? 'Peticiones, quejas, reclamos y sugerencias de los residentes.'
            : 'Tus peticiones, quejas, reclamos y sugerencias, y en qué va cada una.'
        }
        actions={
          <>
            {isStaff && (
              <div className="flex rounded-(--radius-control) border border-line bg-surface p-0.5" role="group" aria-label="Vista">
                <ViewButton active={view === 'list'} icon={List} label="Lista" onClick={() => setFilters({ vista: '' })} />
                <ViewButton active={view === 'board'} icon={Columns3} label="Tablero" onClick={() => setFilters({ vista: 'tablero' })} />
              </div>
            )}
            {tenant.can('pqr.create') && (
              <Link href={`${tenant.path}/pqr/nueva`} className={buttonClass('primary')}>
                <MessageSquarePlus className="size-4" aria-hidden /> Radicar solicitud
              </Link>
            )}
          </>
        }
      />

      {(isStaff || hasFilters || (data?.total ?? 0) > 5) && (
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={isStaff ? 'Buscar por radicado, asunto o residente' : 'Buscar por radicado o asunto'}
              aria-label="Buscar solicitudes"
              className="pl-9"
            />
          </div>
          {view === 'list' && (
            <Select aria-label="Filtrar por estado" className="w-auto! min-w-44" value={filters.status} onChange={(event) => setFilters({ estado: event.target.value })}>
              <option value="">Todos los estados</option>
              {PQR_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PQR_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          )}
          <Select aria-label="Filtrar por tipo" className="w-auto! min-w-44" value={filters.type} onChange={(event) => setFilters({ tipo: event.target.value })}>
            <option value="">Todos los tipos</option>
            {PQR_TYPES.map((type) => (
              <option key={type} value={type}>
                {PQR_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
          {isStaff && (
            <>
              <Select aria-label="Filtrar por prioridad" className="w-auto! min-w-44" value={filters.priority} onChange={(event) => setFilters({ prioridad: event.target.value })}>
                <option value="">Cualquier prioridad</option>
                {PQR_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    Prioridad {PQR_PRIORITY_LABELS[priority].toLowerCase()}
                  </option>
                ))}
              </Select>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-(--radius-control) border border-line bg-surface px-3 text-sm">
                <input type="checkbox" className="size-4 accent-(--brand)" checked={filters.assignedToMe} onChange={(event) => setFilters({ mias: event.target.checked })} />
                Asignadas a mí
              </label>
            </>
          )}
        </div>
      )}

      {pqrs.isPending ? (
        <Skeleton className="h-72" />
      ) : pqrs.isError ? (
        <Card>
          <EmptyState icon={SearchX} title="No pudimos cargar las solicitudes" description="Revisa tu conexión e inténtalo de nuevo." action={<Button onClick={() => void pqrs.refetch()}>Reintentar</Button>} />
        </Card>
      ) : data && data.items.length === 0 ? (
        <Card>
          {hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="Ninguna solicitud coincide"
              description="Prueba con otro texto o quita los filtros."
              action={
                <Button variant="secondary" onClick={() => router.replace(view === 'board' ? '?vista=tablero' : '?', { scroll: false })}>
                  Quitar filtros
                </Button>
              }
            />
          ) : isStaff ? (
            <EmptyState icon={MessagesSquare} title="Aún no hay solicitudes" description="Cuando un residente radique una PQR aparecerá aquí." />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No has radicado solicitudes"
              description="Si necesitas algo de la administración o quieres reportar un problema, radica una solicitud y sigue aquí su estado."
              action={
                <Link href={`${tenant.path}/pqr/nueva`} className={buttonClass('primary')}>
                  Radicar solicitud
                </Link>
              }
            />
          )}
        </Card>
      ) : view === 'board' ? (
        <Board items={data?.items ?? []} dimmed={pqrs.isPlaceholderData} />
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className={cx('divide-y divide-line', pqrs.isPlaceholderData && 'opacity-60')}>
              {data?.items.map((item) => (
                <li key={item.id}>
                  <Link href={`${tenant.path}/pqr/${item.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition hover:bg-surface-2">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="truncate font-medium">{item.subject}</p>
                      <p className="truncate text-sm text-muted">
                        <span className="tabular-nums">{item.filingNumber}</span>, {PQR_TYPE_LABELS[item.type].toLowerCase()}, {formatDate(item.createdAt)}
                        {isStaff && `, ${item.requesterName}${item.propertyLabel ? ` (${item.propertyLabel})` : ''}`}
                      </p>
                    </div>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {isStaff && item.priority === 'high' && <PqrPriorityBadge priority="high" />}
                      {isStaff && item.assigneeName && <Badge>{item.assigneeName}</Badge>}
                      <PqrStatusBadge status={item.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {data && data.totalPages > 1 && (
            <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
              <p>
                {data.total} solicitudes, página {data.page} de {data.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={data.page <= 1} onClick={() => setFilters({ pagina: data.page - 1 })}>
                  Anterior
                </Button>
                <Button variant="secondary" size="sm" disabled={data.page >= data.totalPages} onClick={() => setFilters({ pagina: data.page + 1 })}>
                  Siguiente <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function ViewButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof List; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx('flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium', active ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink')}
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );
}

/** Tablero por estados. Arrastrar una tarjeta a otra columna cambia su estado. */
function Board({ items, dimmed }: { items: PqrListItem[]; dimmed: boolean }) {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const canMove = tenant.can('pqr.manage') || tenant.can('pqr.manage_assigned');
  const [dragging, setDragging] = useState<PqrListItem | null>(null);
  const [over, setOver] = useState<PqrStatus | null>(null);

  const move = useMutation({
    mutationFn: ({ item, status }: { item: PqrListItem; status: PqrStatus }) =>
      api(`${tenant.apiPath}/pqrs/${item.id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async (_, { item, status }) => {
      await queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });
      toast.success(`${item.filingNumber} pasó a ${PQR_STATUS_LABELS[status].toLowerCase()}.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const drop = (status: PqrStatus) => {
    setOver(null);
    if (!dragging || dragging.status === status) return;
    if (!PQR_TRANSITIONS[dragging.status].includes(status)) {
      toast.error(`Una solicitud ${PQR_STATUS_LABELS[dragging.status].toLowerCase()} no puede pasar a ${PQR_STATUS_LABELS[status].toLowerCase()}.`);
      return;
    }
    move.mutate({ item: dragging, status });
  };

  return (
    <div className={cx('grid gap-4 md:grid-cols-2 xl:grid-cols-4', dimmed && 'opacity-60')}>
      {PQR_STATUSES.map((status) => {
        const column = items.filter((item) => item.status === status);
        return (
          <section
            key={status}
            aria-label={PQR_STATUS_LABELS[status]}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={() => drop(status)}
            className={cx('rounded-(--radius-card) border border-line bg-surface-2/60 p-3 transition', over === status && 'border-brand bg-brand-soft')}
          >
            <h2 className="mb-3 flex items-center justify-between px-1">
              <PqrStatusBadge status={status} />
              <span className="text-sm tabular-nums text-muted">{column.length}</span>
            </h2>
            <ul className="flex min-h-16 flex-col gap-2">
              {column.map((item) => (
                <li key={item.id} draggable={canMove} onDragStart={() => setDragging(item)} onDragEnd={() => setDragging(null)}>
                  <Link
                    href={`${tenant.path}/pqr/${item.id}`}
                    draggable={false}
                    className={cx('block rounded-xl border border-line bg-surface p-3 transition hover:border-brand', canMove && 'cursor-grab active:cursor-grabbing')}
                  >
                    <p className="text-xs tabular-nums text-muted">{item.filingNumber}</p>
                    <p className="mt-0.5 line-clamp-2 font-medium leading-snug">{item.subject}</p>
                    <p className="mt-1.5 truncate text-sm text-muted">
                      {item.requesterName}
                      {item.propertyLabel ? `, ${item.propertyLabel}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.priority === 'high' && <PqrPriorityBadge priority="high" />}
                      {item.assigneeName && <Badge>{item.assigneeName}</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
              {column.length === 0 && <li className="px-1 py-3 text-sm text-muted">Sin solicitudes</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function PqrPage() {
  return (
    <Suspense>
      <PqrIndex />
    </Suspense>
  );
}
