'use client';

import { PQR_STATUSES, PQR_STATUS_LABELS, PQR_TYPE_LABELS, type PqrReport } from '@brisas/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChartNoAxesColumn, Info } from 'lucide-react';
import { useState } from 'react';
import { useTenant } from '@/components/tenant-context';
import { Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/forms';

type Preset = 'month' | '30' | '90' | 'year' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'month', label: 'Este mes' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
  { value: 'year', label: 'Este año' },
  { value: 'custom', label: 'Rango personalizado' },
];

function daysAgo(days: number): string {
  const date = new Date(`${todayIso()}T12:00:00`);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function rangeFor(preset: Preset, custom: { from: string; to: string }): { from: string; to: string } {
  const today = todayIso();
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === '30') return { from: daysAgo(29), to: today };
  if (preset === '90') return { from: daysAgo(89), to: today };
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return custom;
}

/** Horas → texto legible: "45 min", "5 h", "3 días". */
function formatHours(hours: number | null): string {
  if (hours === null) return 'Sin datos';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  return `${days} días`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

export default function ReportsPage() {
  const tenant = useTenant();
  const [preset, setPreset] = useState<Preset>('90');
  const [custom, setCustom] = useState({ from: daysAgo(89), to: todayIso() });
  const range = rangeFor(preset, custom);
  const validRange = Boolean(range.from && range.to && range.from <= range.to);

  const report = useQuery({
    queryKey: [tenant.tenantId, 'report-pqr', range],
    queryFn: () => api<PqrReport>(`${tenant.apiPath}/reports/pqr`, { query: range }),
    enabled: validRange,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const byStatus = PQR_STATUSES.map((status) => ({
    label: PQR_STATUS_LABELS[status],
    count: data?.byStatus.find((item) => item.status === status)?.count ?? 0,
  }));

  return (
    <>
      <PageHeader title="Reportes" description="Cómo va la atención de las solicitudes de los residentes." />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Periodo" className="w-56">
          {(props) => (
            <Select {...props} value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>
              {PRESETS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="Desde">{(props) => <Input {...props} type="date" value={custom.from} max={custom.to} onChange={(event) => setCustom({ ...custom, from: event.target.value })} />}</Field>
            <Field label="Hasta" error={validRange ? undefined : 'Debe ser posterior a la fecha inicial'}>
              {(props) => <Input {...props} type="date" value={custom.to} min={custom.from} onChange={(event) => setCustom({ ...custom, to: event.target.value })} />}
            </Field>
          </>
        )}
        {validRange && (
          <p className="pb-2.5 text-sm text-muted">
            Solicitudes radicadas del {formatDate(range.from)} al {formatDate(range.to)}
          </p>
        )}
      </div>

      {report.isPending && validRange ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : data && data.received === 0 ? (
        <Card>
          <EmptyState icon={ChartNoAxesColumn} title="No hay solicitudes en este periodo" description="Elige un periodo más amplio para ver los indicadores." />
        </Card>
      ) : data ? (
        <div className={cx('flex flex-col gap-4', report.isPlaceholderData && 'opacity-60')}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Recibidas" value={String(data.received)} />
            <Tile label="Pendientes" value={String(data.pending)} hint="Por revisar o en trámite" />
            <Tile label="Resueltas" value={String(data.resolved)} hint={`${Math.round((data.resolved / data.received) * 100)}% de las recibidas`} />
            <Tile label="Primera respuesta" value={formatHours(data.avgFirstResponseHours)} hint="Tiempo promedio" />
            <Tile label="Resolución" value={formatHours(data.avgResolutionHours)} hint="Tiempo promedio" />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="mb-1 text-xl font-semibold">Recibidas y resueltas por mes</h2>
              <ul className="mb-4 flex flex-wrap gap-x-5 text-sm text-muted">
                <li className="flex items-center gap-2">
                  <span className="size-3 rounded-sm bg-brand/25" aria-hidden /> Recibidas
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-3 rounded-sm bg-brand" aria-hidden /> De ellas, resueltas
                </li>
              </ul>
              <TrendBars rows={data.trend.map((item) => ({ ...item, label: monthLabel(item.month) }))} />
            </Card>
            <Card className="p-6">
              <h2 className="mb-4 text-xl font-semibold">Por estado actual</h2>
              <BarList rows={byStatus} />
            </Card>
            <Card className="p-6">
              <h2 className="mb-4 text-xl font-semibold">Por categoría</h2>
              <BarList rows={data.byCategory} />
            </Card>
            <Card className="p-6">
              <h2 className="mb-4 text-xl font-semibold">Por torre</h2>
              <BarList rows={data.byTower} />
            </Card>
            <Card className="p-6">
              <h2 className="mb-4 text-xl font-semibold">Por tipo</h2>
              <BarList rows={data.byType.map((item) => ({ label: PQR_TYPE_LABELS[item.type], count: item.count }))} />
            </Card>
            <Card className="p-6">
              <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
                <Info className="size-5 text-muted" aria-hidden /> Cómo se calcula
              </h2>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                <li>Todos los indicadores cuentan las solicitudes radicadas dentro del periodo, por eso los números cuadran entre sí.</li>
                <li>Pendientes son las que hoy están por revisar o en trámite; resueltas, las que hoy están resueltas o cerradas.</li>
                <li>Primera respuesta: tiempo entre la radicación y el primer mensaje de la administración visible para el residente.</li>
                <li>Resolución: tiempo entre la radicación y el momento en que se marcó como resuelta.</li>
                <li>Los tiempos son en horas calendario, incluidos noches y fines de semana.</li>
              </ul>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-surface p-5">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="mt-1 text-sm text-muted">{hint}</dd>}
    </div>
  );
}

/** Barras horizontales de una sola serie: la longitud compara, el número da el valor exacto. */
function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm" title={`${row.label}: ${row.count}`}>
          <span className="truncate">{row.label}</span>
          <span className="h-3 rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(row.count / max) * 100}%`, minWidth: row.count > 0 ? 6 : 0 }} />
          </span>
          <span className="text-right font-medium tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Por mes: la barra clara son las recibidas y la parte oscura, las que ya se resolvieron. */
function TrendBars({ rows }: { rows: { label: string; received: number; resolved: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.received));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm"
          title={`${row.label}: ${row.received} recibidas, ${row.resolved} resueltas`}
        >
          <span className="text-muted">{row.label}</span>
          <span className="h-4">
            <span className="block h-full overflow-hidden rounded bg-brand/25" style={{ width: `${(row.received / max) * 100}%`, minWidth: 6 }}>
              <span className="block h-full rounded-r bg-brand" style={{ width: `${(row.resolved / row.received) * 100}%` }} />
            </span>
          </span>
          <span className="text-right tabular-nums">
            <span className="font-medium">{row.received}</span>
            <span className="text-muted"> / {row.resolved}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
