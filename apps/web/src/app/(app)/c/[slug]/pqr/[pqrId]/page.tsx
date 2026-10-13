'use client';

import {
  PQR_PRIORITIES,
  PQR_PRIORITY_LABELS,
  PQR_STATUS_LABELS,
  PQR_TRANSITIONS,
  PQR_TYPE_LABELS,
  type PqrAssignee,
  type PqrDetail,
  type PqrStatus,
  type UpdatePqrInput,
} from '@brisas/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, FileQuestion, Lock, Send } from 'lucide-react';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { PqrPriorityBadge, PqrProgress, PqrStatusBadge } from '@/components/pqr-bits';
import { useTenant } from '@/components/tenant-context';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, initials } from '@/lib/forms';

const TEXTAREA =
  'min-h-24 w-full rounded-(--radius-control) border border-line bg-surface px-3 py-2.5 text-[15px] placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25';

export default function PqrDetailPage() {
  const tenant = useTenant();
  const { pqrId } = useParams<{ pqrId: string }>();
  const queryClient = useQueryClient();
  const isStaff = tenant.can('pqr.read_all');
  const url = `${tenant.apiPath}/pqrs/${pqrId}`;
  const key = [tenant.tenantId, 'pqr', pqrId];

  const pqr = useQuery({ queryKey: key, queryFn: () => api<PqrDetail>(url) });
  const assignees = useQuery({
    queryKey: [tenant.tenantId, 'pqr-assignees'],
    queryFn: () => api<PqrAssignee[]>(`${tenant.apiPath}/pqrs/assignees`),
    enabled: isStaff && tenant.can('pqr.manage'),
  });
  const [changingTo, setChangingTo] = useState<PqrStatus | null>(null);

  // El servidor devuelve la solicitud actualizada: se muestra de inmediato y se refrescan las listas.
  const apply = async (updated: PqrDetail) => {
    queryClient.setQueryData(key, updated);
    await queryClient.invalidateQueries({ queryKey: [tenant.tenantId, 'pqrs'] });
  };
  const update = useMutation({
    mutationFn: (body: UpdatePqrInput) => api<PqrDetail>(url, { method: 'PATCH', body }),
    onSuccess: async (updated) => {
      await apply(updated);
      setChangingTo(null);
      toast.success('Solicitud actualizada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (pqr.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (pqr.isError) {
    return (
      <Card>
        <EmptyState icon={FileQuestion} title="No encontramos esta solicitud" description="Puede que el enlace esté incompleto o que no tengas acceso a ella." />
      </Card>
    );
  }

  const data = pqr.data;
  const nextStatuses = PQR_TRANSITIONS[data.status];

  return (
    <>
      <PageHeader
        title={data.subject}
        crumbs={[{ label: isStaff ? 'PQR' : 'Mis solicitudes', href: `${tenant.path}/pqr` }, { label: data.filingNumber }]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PqrStatusBadge status={data.status} />
              <Badge>{PQR_TYPE_LABELS[data.type]}</Badge>
              <Badge>{data.category}</Badge>
              {isStaff && <PqrPriorityBadge priority={data.priority} />}
            </div>
            <p className="whitespace-pre-wrap break-words">{data.description}</p>
            <p className="mt-4 text-sm text-muted">
              {data.requesterName}
              {data.propertyLabel ? `, ${data.propertyLabel}` : ''}, {formatDateTime(data.createdAt)}
            </p>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold">Conversación</h2>
            {data.comments.length === 0 ? (
              <p className="mt-3 text-muted">
                {isStaff ? 'Aún no hay mensajes. Tu primera respuesta pondrá la solicitud en trámite.' : 'La administración aún no ha respondido. Te avisaremos por correo cuando lo haga.'}
              </p>
            ) : (
              <ol className="mt-5 flex flex-col gap-4">
                {data.comments.map((comment) => (
                  <li key={comment.id} className={cx('flex gap-3', comment.fromStaff && 'flex-row-reverse')}>
                    <span
                      className={cx(
                        'flex size-9 shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold',
                        comment.fromStaff ? 'bg-ink text-surface' : 'bg-brand-soft text-brand-ink',
                      )}
                    >
                      {initials(comment.authorName)}
                    </span>
                    <div
                      className={cx(
                        'min-w-0 max-w-[85%] rounded-2xl px-4 py-3',
                        comment.isInternal ? 'border border-dashed border-warn/60 bg-warn-soft' : comment.fromStaff ? 'bg-surface-2' : 'bg-brand-soft',
                      )}
                    >
                      {comment.isInternal && (
                        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-warn">
                          <EyeOff className="size-3.5" aria-hidden /> Nota interna, el residente no la ve
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                      <p className="mt-1.5 text-xs text-muted">
                        {comment.authorName}
                        {comment.fromStaff ? ' (administración)' : ''}, {formatDateTime(comment.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {data.canComment ? (
              <Composer url={url} canWriteInternal={data.canManage} onSent={apply} />
            ) : data.status === 'closed' ? (
              <p className="mt-6 flex items-center gap-2 rounded-(--radius-control) bg-surface-2 px-3 py-2.5 text-sm text-muted">
                <Lock className="size-4 shrink-0" aria-hidden /> Esta solicitud está cerrada. Si necesitas algo más, radica una nueva.
              </p>
            ) : null}
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="p-6">
            <h2 className="mb-4 font-display text-lg font-semibold">Estado</h2>
            <PqrProgress status={data.status} />
            <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
              <Meta label="Radicado" value={data.filingNumber} />
              <Meta label="Responsable" value={data.assigneeName ?? 'Sin asignar'} />
              {data.resolvedAt && <Meta label="Resuelta" value={formatDateTime(data.resolvedAt)} />}
              {data.closedAt && <Meta label="Cerrada" value={formatDateTime(data.closedAt)} />}
            </dl>
          </Card>

          {data.canManage && (
            <Card className="flex flex-col gap-4 p-6">
              <h2 className="font-display text-lg font-semibold">Gestionar</h2>
              {nextStatuses.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {nextStatuses.map((status) => (
                    <Button key={status} variant={status === 'resolved' ? 'primary' : 'secondary'} onClick={() => setChangingTo(status)}>
                      {ACTION_LABELS[status]}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">La solicitud está cerrada y ya no admite cambios de estado.</p>
              )}
              <Field label="Prioridad">
                {(props) => (
                  <Select {...props} value={data.priority} disabled={update.isPending} onChange={(event) => update.mutate({ priority: event.target.value as PqrDetail['priority'] })}>
                    {PQR_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PQR_PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {tenant.can('pqr.manage') && (
                <Field label="Responsable">
                  {(props) => (
                    <Select
                      {...props}
                      value={data.assigneeUserId ?? ''}
                      disabled={update.isPending}
                      onChange={(event) => update.mutate({ assigneeUserId: event.target.value || null })}
                    >
                      <option value="">Sin asignar</option>
                      {(assignees.data ?? []).map((person) => (
                        <option key={person.userId} value={person.userId}>
                          {person.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-3 font-display text-lg font-semibold">Historial</h2>
            <ol className="space-y-3 text-sm">
              {data.history.map((item) => (
                <li key={item.id}>
                  <p className="font-medium">{item.fromStatus ? `Pasó a ${PQR_STATUS_LABELS[item.toStatus].toLowerCase()}` : 'Solicitud radicada'}</p>
                  {item.note && <p className="text-muted">“{item.note}”</p>}
                  <p className="text-muted">
                    {item.changedByName ?? 'Sistema'}, {formatDateTime(item.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {changingTo && (
        <StatusDialog
          status={changingTo}
          filingNumber={data.filingNumber}
          loading={update.isPending}
          onClose={() => setChangingTo(null)}
          onConfirm={(note) => update.mutate({ status: changingTo, note })}
        />
      )}
    </>
  );
}

const ACTION_LABELS: Record<PqrStatus, string> = {
  pending_review: 'Devolver a revisión',
  in_progress: 'Poner en trámite',
  resolved: 'Marcar como resuelta',
  closed: 'Cerrar solicitud',
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Composer({ url, canWriteInternal, onSent }: { url: string; canWriteInternal: boolean; onSent: (updated: PqrDetail) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await onSent(await api<PqrDetail>(`${url}/comments`, { method: 'POST', body: { body, isInternal } }));
      setBody('');
      toast.success(isInternal ? 'Nota interna guardada.' : 'Mensaje enviado.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 border-t border-line pt-5">
      <label htmlFor="pqr-mensaje" className="mb-1.5 block text-sm font-medium">
        {isInternal ? 'Nota interna' : canWriteInternal ? 'Responder al residente' : 'Escribir a la administración'}
      </label>
      <textarea
        id="pqr-mensaje"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={5000}
        className={cx(TEXTAREA, isInternal && 'border-dashed border-warn/60 bg-warn-soft')}
        placeholder={isInternal ? 'Solo la verá el equipo de administración' : 'Escribe tu mensaje'}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {canWriteInternal ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-(--brand)" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} />
            Nota interna (el residente no la ve)
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" icon={Send} loading={sending} disabled={!body.trim()}>
          {isInternal ? 'Guardar nota' : 'Enviar mensaje'}
        </Button>
      </div>
    </form>
  );
}

function StatusDialog({
  status,
  filingNumber,
  loading,
  onClose,
  onConfirm,
}: {
  status: PqrStatus;
  filingNumber: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const description =
    status === 'closed'
      ? 'Una solicitud cerrada no se puede volver a abrir ni recibe más mensajes. El residente recibirá un correo.'
      : 'El residente recibirá un correo con el nuevo estado.';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`${ACTION_LABELS[status]}: ${filingNumber}`} description={description}>
      <Field label="Nota para el residente" optional hint="Explica brevemente qué se hizo.">
        {(props) => <Input {...props} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} autoFocus />}
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant={status === 'closed' ? 'danger' : 'primary'} loading={loading} onClick={() => onConfirm(note)}>
          {ACTION_LABELS[status]}
        </Button>
      </div>
    </Dialog>
  );
}
