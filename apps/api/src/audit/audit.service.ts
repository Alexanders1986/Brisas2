import { auditLogs } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../common/request-context';
import type { Tx } from '../database/database.service';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId: string | null;
  /** entidad.acción, p. ej. resident.created */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Frase en español que se muestra en el historial. */
  summary: string;
  /** Nunca incluir contraseñas, tokens ni secretos. */
  changes?: Record<string, unknown>;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  /** Se escribe en la misma transacción que el cambio: o quedan ambos o ninguno. */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      changes: entry.changes,
      ip: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      requestId: entry.meta?.requestId ?? null,
    });
  }
}
