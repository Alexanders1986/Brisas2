import { notificationDeliveries, notificationTemplates } from '@brisas/database';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import { DatabaseService, type Tx } from '../database/database.service';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport';

export interface QueuedEmail {
  tenantId: string | null;
  templateKey: string;
  recipient: string;
  /** Variables de la plantilla ({{nombre}}). Se escapan al renderizar. */
  payload: Record<string, string>;
  /** Identifica el hecho que origina el correo: el mismo hecho nunca envía dos veces. */
  idempotencyKey: string;
}

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 5_000;
const STUCK_AFTER_MS = 5 * 60_000;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function renderTemplate(template: string, payload: Record<string, string>, escape: boolean): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = payload[key] ?? '';
    return escape ? escapeHtml(value) : value.replace(/[\r\n]+/g, ' ');
  });
}

/**
 * Cola de correos sobre PostgreSQL (patrón outbox).
 * - `enqueue` inserta en la misma transacción que el hecho de negocio.
 * - Un trabajador toma lotes con FOR UPDATE SKIP LOCKED (seguro con varias instancias),
 *   envía y reintenta con espera exponencial hasta MAX_ATTEMPTS.
 */
@Injectable()
export class MailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ColaDeCorreos');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfig,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  onModuleInit(): void {
    if (this.config.mailWorkerDisabled) return;
    this.timer = setInterval(() => void this.processPending(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(tx: Tx, email: QueuedEmail): Promise<void> {
    await tx
      .insert(notificationDeliveries)
      .values({ ...email, channel: 'email' })
      .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey });
  }

  /** Procesa un lote de envíos pendientes. Devuelve cuántos se enviaron. */
  async processPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const batch = await this.claimBatch();
      let sent = 0;
      for (const delivery of batch) {
        if (await this.deliver(delivery)) sent += 1;
      }
      return sent;
    } catch (error) {
      this.logger.error({ message: (error as Error).message });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private claimBatch() {
    return this.database.system(async (tx) => {
      const now = new Date();
      // Envíos que quedaron "enviando" porque el proceso murió a mitad de camino.
      await tx
        .update(notificationDeliveries)
        .set({ status: 'failed', lastError: 'Envío interrumpido; se reintenta.' })
        .where(
          and(
            eq(notificationDeliveries.status, 'sending'),
            lt(notificationDeliveries.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
          ),
        );

      const pending = await tx
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            inArray(notificationDeliveries.status, ['queued', 'failed']),
            lte(notificationDeliveries.nextAttemptAt, now),
          ),
        )
        .orderBy(notificationDeliveries.nextAttemptAt)
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (pending.length === 0) return [];

      return tx
        .update(notificationDeliveries)
        .set({ status: 'sending', attempts: sql`${notificationDeliveries.attempts} + 1` })
        .where(
          inArray(
            notificationDeliveries.id,
            pending.map((row) => row.id),
          ),
        )
        .returning();
    });
  }

  private async deliver(delivery: typeof notificationDeliveries.$inferSelect): Promise<boolean> {
    try {
      const template = await this.findTemplate(delivery.tenantId, delivery.templateKey);
      if (!template) throw new Error(`No existe la plantilla ${delivery.templateKey}`);

      const result = await this.transport.send({
        to: delivery.recipient,
        subject: renderTemplate(template.subject, delivery.payload, false),
        html: renderTemplate(template.bodyHtml, delivery.payload, true),
        idempotencyKey: delivery.idempotencyKey,
      });

      await this.database.system((tx) =>
        tx
          .update(notificationDeliveries)
          .set({
            status: 'sent',
            sentAt: new Date(),
            providerMessageId: result.providerMessageId ?? null,
            lastError: null,
            // El contenido puede incluir enlaces de un solo uso: no se conserva tras el envío.
            payload: {},
          })
          .where(eq(notificationDeliveries.id, delivery.id)),
      );
      return true;
    } catch (error) {
      const exhausted = delivery.attempts >= MAX_ATTEMPTS;
      const backoffMs = 60_000 * 2 ** (delivery.attempts - 1);
      await this.database.system((tx) =>
        tx
          .update(notificationDeliveries)
          .set({
            status: exhausted ? 'dead' : 'failed',
            lastError: (error as Error).message.slice(0, 1000),
            nextAttemptAt: new Date(Date.now() + backoffMs),
            ...(exhausted ? { payload: {} } : {}),
          })
          .where(eq(notificationDeliveries.id, delivery.id)),
      );
      this.logger.warn({ deliveryId: delivery.id, attempts: delivery.attempts, exhausted, message: (error as Error).message });
      return false;
    }
  }

  /** La plantilla propia del conjunto tiene prioridad sobre la de la plataforma. */
  private findTemplate(tenantId: string | null, key: string) {
    return this.database.system(async (tx) => {
      const rows = await tx
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.key, key),
            eq(notificationTemplates.channel, 'email'),
            eq(notificationTemplates.isActive, true),
            tenantId
              ? or(eq(notificationTemplates.tenantId, tenantId), isNull(notificationTemplates.tenantId))
              : isNull(notificationTemplates.tenantId),
          ),
        );
      return rows.find((row) => row.tenantId !== null) ?? rows[0];
    });
  }
}
