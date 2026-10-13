'use client';

import {
  type GeneratePropertiesInput,
  type GeneratePropertiesResult,
  PROPERTY_KINDS,
  PROPERTY_KIND_LABELS,
  type Paginated,
  type PropertyInput,
  type PropertySummary,
  TOWER_KINDS,
  TOWER_KIND_LABELS,
  type TowerInput,
  type TowerSummary,
  generatePropertiesSchema,
  propertyInputSchema,
  towerInputSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, LayoutGrid, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Facade, FacadeLegend } from '@/components/facade';
import { useTenant } from '@/components/tenant-context';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, PageHeader, Select, Skeleton, buttonClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { groupByTower } from '@/lib/units';

type Modal =
  | { type: 'tower'; tower?: TowerSummary }
  | { type: 'generate'; tower: TowerSummary }
  | { type: 'unit'; towerId: string | null }
  | { type: 'deleteTower'; tower: TowerSummary }
  | { type: 'detail'; unit: PropertySummary };

export default function UnitsPage() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const canManage = tenant.can('properties.manage');
  const [modal, setModal] = useState<Modal | null>(null);
  const close = () => setModal(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });

  const towers = useQuery({
    queryKey: [tenant.tenantId, 'towers'],
    queryFn: () => api<TowerSummary[]>(`${tenant.apiPath}/towers`),
  });
  const units = useQuery({
    queryKey: [tenant.tenantId, 'properties', 'all', 'with-inactive'],
    queryFn: () =>
      api<Paginated<PropertySummary>>(`${tenant.apiPath}/properties`, { query: { pageSize: 500, includeInactive: true } }),
  });

  const deleteTower = useMutation({
    mutationFn: (tower: TowerSummary) => api(`${tenant.apiPath}/towers/${tower.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      close();
      toast.success('Torre eliminada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const loading = towers.isPending || units.isPending;
  const groups = groupByTower(units.data?.items ?? [], towers.data ?? []);
  const isEmpty = !loading && groups.length === 0;

  return (
    <>
      <PageHeader
        title="Torres y unidades"
        description="Cada ventana es una unidad. Tócala para ver su detalle."
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={Plus} onClick={() => setModal({ type: 'unit', towerId: null })}>
                Agregar unidad
              </Button>
              <Button icon={Building2} onClick={() => setModal({ type: 'tower' })}>
                Nueva torre
              </Button>
            </>
          )
        }
      />

      {loading ? (
        <Skeleton className="h-72" />
      ) : isEmpty ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Dibuja tu conjunto"
            description="Crea una torre y genera todos sus apartamentos de una vez. Si tu conjunto es de casas, agrégalas como unidades sin torre."
            action={canManage && <Button onClick={() => setModal({ type: 'tower' })}>Crear la primera torre</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <FacadeLegend />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => {
              const tower = towers.data?.find((item) => item.id === group.id);
              const occupied = group.units.filter((unit) => unit.isActive && unit.activeOccupants > 0).length;
              const active = group.units.filter((unit) => unit.isActive).length;
              return (
                <Card key={group.id ?? 'sin-torre'} className="p-6">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{group.name}</h2>
                      <p className="text-sm text-muted">
                        {active === 0 ? 'Sin unidades' : `${occupied} de ${active} unidades ocupadas`}
                      </p>
                    </div>
                    {canManage && tower && (
                      <div className="flex items-center">
                        <Button variant="secondary" size="sm" icon={LayoutGrid} onClick={() => setModal({ type: 'generate', tower })}>
                          Generar unidades
                        </Button>
                        <IconButton label={`Renombrar ${tower.name}`} icon={Pencil} onClick={() => setModal({ type: 'tower', tower })} />
                        <IconButton label={`Eliminar ${tower.name}`} icon={Trash2} onClick={() => setModal({ type: 'deleteTower', tower })} />
                      </div>
                    )}
                  </div>
                  {group.units.length > 0 ? (
                    <Facade units={group.units} onSelect={(unit) => setModal({ type: 'detail', unit })} />
                  ) : (
                    <p className="text-muted">Esta torre aún no tiene unidades. Usa “Generar unidades” para crearlas todas de una vez.</p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {modal?.type === 'tower' && <TowerDialog tower={modal.tower} onClose={close} onSaved={refresh} onCreated={(tower) => setModal({ type: 'generate', tower })} />}
      {modal?.type === 'generate' && <GenerateDialog tower={modal.tower} onClose={close} onSaved={refresh} />}
      {modal?.type === 'unit' && <UnitDialog towers={towers.data ?? []} onClose={close} onSaved={refresh} />}
      {modal?.type === 'detail' && <UnitDetailDialog unit={modal.unit} canManage={canManage} onClose={close} onSaved={refresh} />}
      {modal?.type === 'deleteTower' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Eliminar ${modal.tower.name}`}
          description="Solo se puede eliminar una torre que no tenga unidades. Esta acción no se puede deshacer."
          confirmLabel="Eliminar torre"
          danger
          loading={deleteTower.isPending}
          onConfirm={() => deleteTower.mutate(modal.tower)}
        />
      )}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function Actions({ label, loading, onClose }: { label: string; loading: boolean; onClose: () => void }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
      <Button type="submit" loading={loading}>
        {label}
      </Button>
    </div>
  );
}

function TowerDialog({ tower, onClose, onSaved, onCreated }: DialogProps & { tower?: TowerSummary; onCreated: (tower: TowerSummary) => void }) {
  const tenant = useTenant();
  const form = useForm<TowerInput, unknown, z.output<typeof towerInputSchema>>({
    resolver: zodResolver(towerInputSchema),
    defaultValues: { name: tower?.name ?? '', kind: tower?.kind ?? 'tower' },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      if (tower) {
        await api(`${tenant.apiPath}/towers/${tower.id}`, { method: 'PUT', body: { ...values, floors: tower.floors } });
        await onSaved();
        toast.success('Torre actualizada.');
        onClose();
      } else {
        const created = await api<TowerSummary>(`${tenant.apiPath}/towers`, { method: 'POST', body: values });
        await onSaved();
        toast.success(`${created.name} creada. Ahora genera sus unidades.`);
        onCreated(created);
      }
    } catch (error) {
      handleFormError(error, form.setError, ['name', 'kind']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={tower ? `Editar ${tower.name}` : 'Nueva torre o bloque'}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Nombre" error={form.formState.errors.name?.message} hint="Por ejemplo: Torre 1, Bloque A o Etapa 2.">
          {(props) => <Input {...props} autoFocus {...form.register('name')} />}
        </Field>
        <Field label="Tipo">
          {(props) => (
            <Select {...props} {...form.register('kind')}>
              {TOWER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {TOWER_KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Actions label={tower ? 'Guardar cambios' : 'Crear torre'} loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function GenerateDialog({ tower, onClose, onSaved }: DialogProps & { tower: TowerSummary }) {
  const tenant = useTenant();
  const form = useForm<GeneratePropertiesInput, unknown, z.output<typeof generatePropertiesSchema>>({
    resolver: zodResolver(generatePropertiesSchema),
    defaultValues: { towerId: tower.id, fromFloor: 1, toFloor: tower.floors ?? 5, unitsPerFloor: 4, kind: 'apartment' },
  });
  const { errors } = form.formState;
  const [from, to, perFloor] = form.watch(['fromFloor', 'toFloor', 'unitsPerFloor']).map(Number) as [number, number, number];
  const total = to >= from && perFloor > 0 ? (to - from + 1) * perFloor : 0;
  const pad = (unit: number) => String(unit).padStart(2, '0');

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await api<GeneratePropertiesResult>(`${tenant.apiPath}/properties/generate`, { method: 'POST', body: values });
      await onSaved();
      toast.success(
        result.skipped > 0
          ? `Se crearon ${result.created} unidades. ${result.skipped} ya existían y se dejaron como estaban.`
          : `Se crearon ${result.created} unidades.`,
      );
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['fromFloor', 'toFloor', 'unitsPerFloor']);
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Generar unidades de ${tower.name}`}
      description="Crea todos los apartamentos de una vez. Las unidades que ya existan no se tocan."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Desde el piso" error={errors.fromFloor?.message}>
            {(props) => <Input {...props} type="number" min={1} inputMode="numeric" {...form.register('fromFloor')} />}
          </Field>
          <Field label="Hasta el piso" error={errors.toFloor?.message}>
            {(props) => <Input {...props} type="number" min={1} inputMode="numeric" {...form.register('toFloor')} />}
          </Field>
          <Field label="Por piso" error={errors.unitsPerFloor?.message}>
            {(props) => <Input {...props} type="number" min={1} max={40} inputMode="numeric" {...form.register('unitsPerFloor')} />}
          </Field>
        </div>
        {total > 0 && (
          <p className="rounded-(--radius-control) bg-brand-soft px-3 py-2.5 text-sm text-brand-ink">
            Se crearán hasta <strong>{total} unidades</strong>, numeradas del {from}
            {pad(1)} al {to}
            {pad(perFloor)}.
          </p>
        )}
        <Actions label="Generar unidades" loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function UnitDialog({ towers, onClose, onSaved }: DialogProps & { towers: TowerSummary[] }) {
  const tenant = useTenant();
  const form = useForm<PropertyInput, unknown, z.output<typeof propertyInputSchema>>({
    resolver: zodResolver(propertyInputSchema),
    defaultValues: { towerId: null, kind: towers.length > 0 ? 'apartment' : 'house', number: '' },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      const created = await api<PropertySummary>(`${tenant.apiPath}/properties`, { method: 'POST', body: values });
      await onSaved();
      toast.success(`Unidad ${created.label} creada.`);
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['number', 'towerId', 'floor', 'kind']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Agregar unidad">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            {(props) => (
              <Select {...props} {...form.register('kind')}>
                {PROPERTY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {PROPERTY_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Número" error={errors.number?.message}>
            {(props) => <Input {...props} autoFocus {...form.register('number')} />}
          </Field>
        </div>
        {towers.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Torre" optional error={errors.towerId?.message}>
              {(props) => (
                <Select {...props} {...form.register('towerId', { setValueAs: (value: string) => value || null })}>
                  <option value="">Sin torre</option>
                  {towers.map((tower) => (
                    <option key={tower.id} value={tower.id}>
                      {tower.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Piso" optional error={errors.floor?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  {...form.register('floor', { setValueAs: (value: string) => (value === '' ? null : value) })}
                />
              )}
            </Field>
          </div>
        )}
        <Actions label="Crear unidad" loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function UnitDetailDialog({ unit, canManage, onClose, onSaved }: DialogProps & { unit: PropertySummary; canManage: boolean }) {
  const tenant = useTenant();
  const toggle = useMutation({
    mutationFn: () => api(`${tenant.apiPath}/properties/${unit.id}`, { method: 'PATCH', body: { isActive: !unit.isActive } }),
    onSuccess: async () => {
      await onSaved();
      toast.success(unit.isActive ? 'Unidad desactivada.' : 'Unidad activada.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const occupied = unit.activeOccupants > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={unit.label}>
      <div className="flex flex-wrap gap-2">
        {!unit.isActive ? (
          <Badge>Desactivada</Badge>
        ) : occupied ? (
          <Badge tone="brand">{unit.activeOccupants === 1 ? '1 persona vinculada' : `${unit.activeOccupants} personas vinculadas`}</Badge>
        ) : (
          <Badge>Libre</Badge>
        )}
        {unit.floor !== null && <Badge>Piso {unit.floor}</Badge>}
        {unit.areaM2 !== null && <Badge>{unit.areaM2} m²</Badge>}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {unit.isActive && tenant.can('residents.manage') && (
          <Link href={`${tenant.path}/residentes/nuevo`} className={buttonClass('primary')}>
            <UserPlus className="size-4" aria-hidden /> Registrar residente
          </Link>
        )}
        {occupied && tenant.can('residents.read') && (
          <Link href={`${tenant.path}/residentes${unit.towerId ? `?torre=${unit.towerId}` : ''}`} className={buttonClass('secondary')}>
            Ver residentes{unit.towerName ? ` de ${unit.towerName}` : ''}
          </Link>
        )}
        {canManage && (
          <Button variant="ghost" loading={toggle.isPending} disabled={unit.isActive && occupied} onClick={() => toggle.mutate()}>
            {unit.isActive ? 'Desactivar unidad' : 'Activar unidad'}
          </Button>
        )}
        {canManage && unit.isActive && occupied && (
          <p className="text-center text-sm text-muted">Para desactivarla, termina primero las vinculaciones de sus residentes.</p>
        )}
      </div>
    </Dialog>
  );
}
