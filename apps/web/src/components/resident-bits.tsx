import { ACCESS_STATUS_LABELS, type AccessStatus } from '@brisas/contracts';
import { CircleCheck, CircleSlash, MailOpen, Minus } from 'lucide-react';
import { Badge } from './ui';

const ACCESS_BADGES = {
  none: { tone: 'neutral', icon: Minus },
  invited: { tone: 'warn', icon: MailOpen },
  active: { tone: 'ok', icon: CircleCheck },
  disabled: { tone: 'danger', icon: CircleSlash },
} as const;

export function AccessBadge({ status }: { status: AccessStatus }) {
  const { tone, icon } = ACCESS_BADGES[status];
  return (
    <Badge tone={tone} icon={icon}>
      {ACCESS_STATUS_LABELS[status]}
    </Badge>
  );
}
