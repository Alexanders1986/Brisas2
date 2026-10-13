'use client';

import {
  type CreateTenantInput,
  type Paginated,
  type PlanSummary,
  type PlatformMetrics,
  type TenantSummary,
  createTenantSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleCheck, CircleSlash, Plus, Search, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useSession } from '@/components/providers';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, handleFormError } from '@/lib/forms';

const NAV = [{ href: '/plataforma', label: 'Conjuntos', icon: Building2, exact: true }];

export default function PlatformPage() {
  const { me } = useSession();
  return (
    <Shell title="Brisas" subtitle="Consola de plataforma" nav={NAV}>
      {me?.isPlatformAdmin ? (
        <Tenants />
      ) : (
        <EmptyState icon={ShieldX} title="Esta sección es solo para el equipo de plataforma" description="Tu cuenta no tiene permiso para administrar conjuntos." />
      )}
    </Shell>
  );
}

function Tenants() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<TenantSummary | null>(null);

  const metrics = useQuery({ queryKey: ['platform', 'metrics'], queryFn: () => api<PlatformMetrics>('/platform/metrics') });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search, status],
    queryFn: () => api<Paginated<TenantSummary>>('/platform/tenants', { query: { search, status, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform'] });

  const setTenantStatus = useMutation({
    mutationFn: (tenant: TenantSummary) =>
      api(`/platform/tenants/${tenant.id}/status`, {
        method: 'PUT',
        body: { status: tenant.status === 'active' ? 'suspended' : 'active' },
      }),
    onSuccess: async (_, tenant) => {
      await refresh();
      setToggling(null);
      toast.success(tenant.status === 'active' ? 'Conjunto desactivado.' : 'Conjunto activado.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const stats = [
    { label: 'Conjuntos activos', value: metrics.data?.tenantsActive },
    { label: 'Conjuntos desactivados', value: metrics.data?.tenantsSuspended },
    { label: 'Unidades administradas', value: metrics.data?.unitsTotal },
    { label: 'Cuentas activas', value: metrics.data?.usersActive },
  ];

  return (
    <>
      <PageHeader
        title="Conjuntos residenciales"
        description="Crea conjuntos, asigna su plan y activa o desactiva su servicio."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Crear conjunto
          </Button>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-(--radius-card) border border-line bg-surface p-5">
            <dt className="text-sm font-medium text-muted">{stat.label}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">
              {stat.value ?? <Skeleton className="h-8 w-12" />}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, identificador o NIT"
            aria-label="Buscar conjuntos"
            className="pl-9"
          />
        </div>
        <Select aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="suspended">Desactivados</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {tenants.isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : tenants.data && tenants.data.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search || status ? 'Ningún conjunto coincide' : 'Aún no hay conjuntos'}
            description={search || status ? 'Prueba con otro texto o quita el filtro.' : 'Crea el primero e invita a su administrador.'}
            action={!search && !status && <Button onClick={() => setCreating(true)}>Crear conjunto</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {tenants.data?.items.map((tenant) => (
              <li key={tenant.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate font-display text-lg font-semibold">{tenant.name}</p>
                  <p className="truncate text-sm text-muted">
                    /{tenant.slug}
                    {tenant.city ? `, ${tenant.city}` : ''}, creado el {formatDate(tenant.createdAt)}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  <span className="font-medium text-ink">{tenant.unitsCount}</span> unidades,{' '}
                  <span className="font-medium text-ink">{tenant.activeResidentsCount}</span> residentes
                </p>
                <Badge>Plan {tenant.planName}</Badge>
                {tenant.status === 'active' ? (
                  <Badge tone="ok" icon={CircleCheck}>
                    Activo
                  </Badge>
                ) : (
                  <Badge tone="danger" icon={CircleSlash}>
                    Desactivado
                  </Badge>
                )}
                <Button variant="secondary" size="sm" onClick={() => setToggling(tenant)}>
                  {tenant.status === 'active' ? 'Desactivar' : 'Activar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <CreateTenantDialog onClose={() => setCreating(false)} onSaved={refresh} />}
      {toggling && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setToggling(null)}
          title={toggling.status === 'active' ? `Desactivar ${toggling.name}` : `Activar ${toggling.name}`}
          description={
            toggling.status === 'active'
              ? 'Nadie del conjunto podrá entrar ni operar hasta que lo actives de nuevo. Sus datos se conservan.'
              : 'El conjunto volverá a estar disponible para sus administradores y residentes.'
          }
          confirmLabel={toggling.status === 'active' ? 'Desactivar conjunto' : 'Activar conjunto'}
          danger={toggling.status === 'active'}
          loading={setTenantStatus.isPending}
          onConfirm={() => setTenantStatus.mutate(toggling)}
        />
      )}
    </>
  );
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function CreateTenantDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api<PlanSummary[]>('/platform/plans') });
  const form = useForm<CreateTenantInput, unknown, z.output<typeof createTenantSchema>>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { name: '', slug: '', city: '', planKey: 'basic', admin: { firstName: '', lastName: '', email: '' } },
  });
  const { errors, dirtyFields } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      const created = await api<TenantSummary>('/platform/tenants', { method: 'POST', body: values });
      await onSaved();
      toast.success(`${created.name} creado. Enviamos la invitación a ${values.admin.email}.`);
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['name', 'slug', 'city', 'planKey', 'admin.email', 'admin.firstName', 'admin.lastName']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Crear conjunto" description="Su primer administrador recibirá un correo para activar la cuenta." wide>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Nombre del conjunto" error={errors.name?.message} className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              autoFocus
              {...form.register('name', {
                // El identificador se propone a partir del nombre hasta que la persona lo edite.
                onChange: (event: { target: { value: string } }) => {
                  if (!dirtyFields.slug) form.setValue('slug', slugify(event.target.value));
                },
              })}
            />
          )}
        </Field>
        <Field label="Identificador en la dirección web" error={errors.slug?.message} hint="Solo minúsculas, números y guiones.">
          {(props) => <Input {...props} {...form.register('slug')} />}
        </Field>
        <Field label="Ciudad" optional error={errors.city?.message}>
          {(props) => <Input {...props} {...form.register('city')} />}
        </Field>
        <Field label="Plan" error={errors.planKey?.message} className="sm:col-span-2">
          {(props) => (
            <Select {...props} {...form.register('planKey')}>
              {(plans.data ?? [{ key: 'basic', name: 'Básico', maxUnits: 100 }]).map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.name} ({plan.maxUnits ? `hasta ${plan.maxUnits} unidades` : 'unidades ilimitadas'})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <h3 className="font-display font-semibold sm:col-span-2">Administrador del conjunto</h3>
        <Field label="Nombres" error={errors.admin?.firstName?.message}>
          {(props) => <Input {...props} {...form.register('admin.firstName')} />}
        </Field>
        <Field label="Apellidos" error={errors.admin?.lastName?.message}>
          {(props) => <Input {...props} {...form.register('admin.lastName')} />}
        </Field>
        <Field label="Correo electrónico" error={errors.admin?.email?.message} className="sm:col-span-2">
          {(props) => <Input {...props} type="email" {...form.register('admin.email')} />}
        </Field>
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Crear conjunto
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
