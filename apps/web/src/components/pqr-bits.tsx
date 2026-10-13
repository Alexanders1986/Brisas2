import { PQR_PRIORITY_LABELS, PQR_STATUSES, PQR_STATUS_LABELS, type PqrPriority, type PqrStatus } from '@brisas/contracts';
import { ArrowDown, ArrowUp, Check, CircleCheck, Hourglass, Inbox, Lock, Minus } from 'lucide-react';
import { Badge, cx } from './ui';

const STATUS = {
  pending_review: { tone: 'warn', icon: Inbox },
  in_progress: { tone: 'brand', icon: Hourglass },
  resolved: { tone: 'ok', icon: CircleCheck },
  closed: { tone: 'neutral', icon: Lock },
} as const;

/** Estado con texto e ícono: no depende solo del color. */
export function PqrStatusBadge({ status }: { status: PqrStatus }) {
  const { tone, icon } = STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {PQR_STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY = {
  low: { tone: 'neutral', icon: ArrowDown },
  medium: { tone: 'neutral', icon: Minus },
  high: { tone: 'danger', icon: ArrowUp },
} as const;

export function PqrPriorityBadge({ priority }: { priority: PqrPriority }) {
  const { tone, icon } = PRIORITY[priority];
  return (
    <Badge tone={tone} icon={icon}>
      Prioridad {PQR_PRIORITY_LABELS[priority].toLowerCase()}
    </Badge>
  );
}

/** Recorrido de la solicitud: en qué paso va y cuáles ya pasó. */
export function PqrProgress({ status }: { status: PqrStatus }) {
  const current = PQR_STATUSES.indexOf(status);
  return (
    <ol className="flex flex-col gap-0">
      {PQR_STATUSES.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex gap-3" aria-current={active ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  done && 'border-brand bg-brand text-on-brand',
                  active && 'border-brand text-brand-ink',
                  !done && !active && 'border-line text-muted',
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : index + 1}
              </span>
              {index < PQR_STATUSES.length - 1 && <span className={cx('my-1 h-5 w-0.5', done ? 'bg-brand' : 'bg-line')} />}
            </div>
            <span className={cx('pt-0.5', active ? 'font-semibold' : done ? '' : 'text-muted')}>
              {PQR_STATUS_LABELS[step]}
              {active && <span className="sr-only"> (estado actual)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
