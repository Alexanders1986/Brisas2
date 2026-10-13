'use client';

import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type OccupancySummary,
  PARKING_KIND_LABELS,
  PET_SPECIES_LABELS,
  type PersonInput,
  RELATIONSHIP_LABELS,
  type ResidentDetail,
  personInputSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileClock, History, Mail, PawPrint, Pencil, Phone, SquareParking, UserX, Warehouse } from 'lucide-react';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AccessBadge } from '@/components/resident-bits';
import { useTenant } from '@/components/tenant-context';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, handleFormError, initials, todayIso } from '@/lib/forms';

export default function ResidentDetailPage() {
  const tenant = useTenant();
  const { personId } = useParams<{ personId: string }>();
  const queryClient = useQueryClient();
  const canManage = tenant.can('residents.manage');
  const [editing, setEditing] = useState(false);
  const [confirmAccess, setConfirmAccess] = useState(false);
  const [ending, setEnding] = useState<OccupancySummary | null>(null);

  const url = `${tenant.apiPath}/residents/${personId}`;
  const resident = useQuery({ queryKey: [tenant.tenantId, 'resident', personId], queryFn: () => api<ResidentDetail>(url) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });

  const access = useMutation({
    mutationFn: (enabled: boolean) =>
      api<{ invitationSent: boolean }>(`${url}/access`, { method: 'PUT', body: { enabled } }),
    onSuccess: async (result, enabled) => {
      await refresh();
      setConfirmAccess(false);
      toast.success(
        enabled ? (result.invitationSent ? 'Acceso activado. Enviamos la invitación a su correo.' : 'Acceso activado.') : 'Acceso desactivado.',
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (resident.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (resident.isError) {
    return (
      <Card>
        <EmptyState icon={UserX} title="No encontramos a esta persona" description="Puede que el enlace esté incompleto o que ya no esté registrada." />
      </Card>
    );
  }

  const data = resident.data;
  const fullName = `${data.firstName} ${data.lastName}`;
  const hasAccess = data.accessStatus === 'active' || data.accessStatus === 'invited';

  return (
    <>
      <PageHeader
        title={fullName}
        crumbs={[{ label: 'Residentes', href: `${tenant.path}/residentes` }, { label: fullName }]}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Editar datos
              </Button>
              {hasAccess ? (
                <Button variant="secondary" onClick={() => setConfirmAccess(true)}>
                  Desactivar acceso
                </Button>
              ) : (
                <Button loading={access.isPending} onClick={() => access.mutate(true)}>
                  {data.accessStatus === 'disabled' ? 'Reactivar acceso' : 'Dar acceso al portal'}
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-lg font-semibold text-brand-ink">
              {initials(fullName)}
            </span>
            <div>
              <AccessBadge status={data.accessStatus} />
              <p className="mt-1 text-sm text-muted">Registrado el {formatDate(data.createdAt)}</p>
            </div>
          </div>
          <dl className="mt-6 space-y-4">
            <Row icon={Mail} label="Correo" value={data.email} />
            <Row icon={Phone} label="Celular" value={data.phone} />
            <Row
              icon={data.libertadTradicionAvailable ? FileCheck2 : FileClock}
              label="Documento"
              value={data.documentNumber ? `${data.documentType ?? ''} ${data.documentNumber}` : null}
            />
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold">Vinculaciones</h2>
          {data.occupancyHistory.length === 0 ? (
            <p className="mt-3 text-muted">Esta persona no tiene vinculaciones registradas.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {data.occupancyHistory.map((occupancy) => (
                <li key={occupancy.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="font-medium">{occupancy.propertyLabel}</p>
                    <p className="text-sm text-muted">
                      {RELATIONSHIP_LABELS[occupancy.relationship]}, {formatDate(occupancy.startDate)} a{' '}
                      {occupancy.endDate ? formatDate(occupancy.endDate) : 'hoy'}
                    </p>
                  </div>
                  {occupancy.endDate ? (
                    <Badge>Terminada</Badge>
                  ) : (
                    <>
                      <Badge tone="ok">Vigente</Badge>
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setEnding(occupancy)}>
                          Terminar
                        </Button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(data.parkingSpaces.length > 0 || data.storageUnits.length > 0 || data.pets.length > 0) && (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
              {data.parkingSpaces.map((item) => (
                <Badge key={item.id} icon={SquareParking}>
                  {PARKING_KIND_LABELS[item.kind]} {item.number}
                </Badge>
              ))}
              {data.storageUnits.map((item) => (
                <Badge key={item.id} icon={Warehouse}>
                  Depósito {item.number}
                </Badge>
              ))}
              {data.pets.map((pet) => (
                <Badge key={pet.id} icon={PawPrint}>
                  {pet.name ?? PET_SPECIES_LABELS[pet.species]}
                  {pet.breed ? ` (${pet.breed})` : ''}
                </Badge>
              ))}
            </div>
          )}
          <p className="mt-5 flex items-center gap-2 text-sm text-muted">
            {data.libertadTradicionAvailable ? (
              <>
                <FileCheck2 className="size-4 text-ok" aria-hidden /> Certificado de libertad y tradición disponible
              </>
            ) : (
              <>
                <FileClock className="size-4" aria-hidden /> Certificado de libertad y tradición pendiente
              </>
            )}
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <History className="size-5 text-muted" aria-hidden /> Historial de cambios
        </h2>
        <ol className="mt-4 space-y-4">
          {data.changes.map((change) => (
            <li key={change.id} className="flex gap-3">
              <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
              <div>
                <p>{change.summary}</p>
                <p className="text-sm text-muted">
                  {change.actorName ?? 'Sistema'}, {formatDateTime(change.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {editing && <EditDialog resident={data} url={url} onClose={() => setEditing(false)} onSaved={refresh} />}
      {ending && <EndOccupancyDialog occupancy={ending} url={url} onClose={() => setEnding(null)} onSaved={refresh} />}
      <ConfirmDialog
        open={confirmAccess}
        onOpenChange={setConfirmAccess}
        title={`Desactivar el acceso de ${data.firstName}`}
        description="Dejará de poder entrar al portal de este conjunto de inmediato. Sus datos y su historial se conservan, y puedes reactivarlo cuando quieras."
        confirmLabel="Desactivar acceso"
        danger
        loading={access.isPending}
        onConfirm={() => access.mutate(false)}
      />
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="break-words font-medium">{value ?? <span className="font-normal text-muted">Sin registrar</span>}</dd>
      </div>
    </div>
  );
}

const PERSON_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'documentType', 'documentNumber'] as const;

function EditDialog({
  resident,
  url,
  onClose,
  onSaved,
}: {
  resident: ResidentDetail;
  url: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const form = useForm<PersonInput>({
    resolver: zodResolver(personInputSchema),
    defaultValues: {
      firstName: resident.firstName,
      lastName: resident.lastName,
      email: resident.email ?? '',
      phone: resident.phone ?? '',
      documentType: resident.documentType ?? '',
      documentNumber: resident.documentNumber ?? '',
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(url, { method: 'PUT', body: values });
      await onSaved();
      toast.success('Datos actualizados.');
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, PERSON_FIELDS);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Editar datos personales" wide>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Nombres" error={errors.firstName?.message}>
          {(props) => <Input {...props} {...form.register('firstName')} />}
        </Field>
        <Field label="Apellidos" error={errors.lastName?.message}>
          {(props) => <Input {...props} {...form.register('lastName')} />}
        </Field>
        <Field label="Correo electrónico" optional error={errors.email?.message}>
          {(props) => <Input {...props} type="email" {...form.register('email')} />}
        </Field>
        <Field label="Celular" optional error={errors.phone?.message}>
          {(props) => <Input {...props} type="tel" {...form.register('phone')} />}
        </Field>
        <Field label="Tipo de documento" optional error={errors.documentType?.message}>
          {(props) => (
            <Select {...props} {...form.register('documentType')}>
              <option value="">Selecciona</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Número de documento" optional error={errors.documentNumber?.message}>
          {(props) => <Input {...props} {...form.register('documentNumber')} />}
        </Field>
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Guardar cambios
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function EndOccupancyDialog({
  occupancy,
  url,
  onClose,
  onSaved,
}: {
  occupancy: OccupancySummary;
  url: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [endDate, setEndDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api(`${url}/occupancies/${occupancy.id}/end`, { method: 'POST', body: { endDate } });
      await onSaved();
      toast.success('Vinculación terminada.');
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Terminar la vinculación con ${occupancy.propertyLabel}`}
      description="Queda guardada en el historial de ocupación. Si era su única vinculación vigente, se suspende su acceso al portal."
    >
      <Field label="Fecha de salida" error={error ?? undefined}>
        {(props) => (
          <Input {...props} type="date" min={occupancy.startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        )}
      </Field>
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="danger" loading={loading} disabled={!endDate} onClick={() => void submit()}>
          Terminar vinculación
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2 sm:col-span-2">{children}</div>;
}
