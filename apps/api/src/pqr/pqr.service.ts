import {
  PQR_STATUS_LABELS,
  PQR_TRANSITIONS,
  type Paginated,
  type PqrAssignee,
  type PqrDetail,
  type PqrListItem,
  type PqrReport,
  type PqrStatus,
  type PqrType,
  propertyLabel,
} from '@brisas/contracts';
import {
  persons,
  pqrComments,
  pqrSequences,
  pqrStatusHistory,
  pqrs,
  properties,
  propertyOccupancies,
  rolePermissions,
  tenantSettings,
  tenants,
  towers,
  userTenantMemberships,
  users,
} from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { type SQL, and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { likePattern, paginate } from '../common/pagination';
import type { RequestMeta, TenantContext } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { DatabaseService, type Tx } from '../database/database.service';
import { MailQueueService } from '../notifications/mail-queue.service';
import type { CreatePqrDto, ListPqrQueryDto, PqrCommentDto, PqrReportQueryDto, UpdatePqrDto } from './pqr.dto';

type Pqr = typeof pqrs.$inferSelect;

const assignee = alias(users, 'assignee');
const DEFAULT_TIMEZONE = 'America/Bogota';

@Injectable()
export class PqrService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------- consulta

  async list(tenant: TenantContext, query: ListPqrQueryDto): Promise<Paginated<PqrListItem>> {
    return this.database.tenant(tenant, async (tx) => {
      const timezone = await this.timezone(tx, tenant);
      const pattern = query.search ? likePattern(query.search) : undefined;
      const localDate = sql`(${pqrs.createdAt} AT TIME ZONE ${timezone})::date`;
      const where = and(
        this.visibility(tenant),
        query.status ? eq(pqrs.status, query.status) : undefined,
        query.type ? eq(pqrs.type, query.type) : undefined,
        query.priority ? eq(pqrs.priority, query.priority) : undefined,
        query.towerId ? eq(properties.towerId, query.towerId) : undefined,
        query.assignedToMe ? eq(pqrs.assigneeUserId, tenant.userId) : undefined,
        query.from ? sql`${localDate} >= ${query.from}::date` : undefined,
        query.to ? sql`${localDate} <= ${query.to}::date` : undefined,
        pattern ? or(ilike(pqrs.filingNumber, pattern), ilike(pqrs.subject, pattern), ilike(users.displayName, pattern)) : undefined,
      );
      const [total] = await tx
        .select({ value: count() })
        .from(pqrs)
        .innerJoin(users, eq(users.id, pqrs.requesterUserId))
        .leftJoin(properties, eq(properties.id, pqrs.propertyId))
        .where(where);
      const rows = await this.selectItems(tx)
        .where(where)
        .orderBy(desc(pqrs.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return paginate(rows.map(toListItem), total?.value ?? 0, query.page, query.pageSize);
    });
  }

  async get(tenant: TenantContext, pqrId: string): Promise<PqrDetail> {
    return this.database.tenant(tenant, (tx) => this.detail(tx, tenant, pqrId));
  }

  /** Personal al que se le puede asignar una PQR. */
  async assignees(tenant: TenantContext): Promise<PqrAssignee[]> {
    this.assertStaff(tenant);
    return this.database.tenant(tenant, (tx) => this.staff(tx));
  }

  // ------------------------------------------------------------- radicación

  async create(tenant: TenantContext, input: CreatePqrDto, meta: RequestMeta): Promise<PqrDetail> {
    if (!tenant.permissions.has('pqr.create')) throw AppError.forbidden();
    return this.database.tenant(tenant, async (tx) => {
      // La persona y sus unidades salen de la sesión, no de lo que envía el cliente.
      const units = await tx
        .select({ personId: persons.id, propertyId: propertyOccupancies.propertyId })
        .from(persons)
        .leftJoin(
          propertyOccupancies,
          and(eq(propertyOccupancies.personId, persons.id), isNull(propertyOccupancies.endDate)),
        )
        .where(and(eq(persons.userId, tenant.userId), isNull(persons.deletedAt)));
      const ownUnits = units.map((unit) => unit.propertyId).filter((id): id is string => id !== null);
      if (input.propertyId && !ownUnits.includes(input.propertyId)) {
        throw AppError.unprocessable('PROPERTY_NOT_YOURS', 'Solo puedes radicar solicitudes sobre tus unidades.', {
          fields: { propertyId: 'Selecciona una de tus unidades' },
        });
      }
      const propertyId = input.propertyId ?? (ownUnits.length === 1 ? ownUnits[0] : undefined);

      const timezone = await this.timezone(tx, tenant);
      const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(new Date()));
      // El consecutivo se incrementa de forma atómica: dos radicaciones simultáneas nunca
      // reciben el mismo número.
      const [sequence] = await tx
        .insert(pqrSequences)
        .values({ tenantId: tenant.tenantId, year, lastValue: 1 })
        .onConflictDoUpdate({
          target: [pqrSequences.tenantId, pqrSequences.year],
          set: { lastValue: sql`"pqr_sequences"."last_value" + 1` },
        })
        .returning({ value: pqrSequences.lastValue });
      const filingNumber = `PQR-${year}-${String(sequence!.value).padStart(6, '0')}`;

      const [pqr] = await tx
        .insert(pqrs)
        .values({
          tenantId: tenant.tenantId,
          filingNumber,
          type: input.type,
          category: input.category,
          subject: input.subject,
          description: input.description,
          requesterUserId: tenant.userId,
          requesterPersonId: units[0]?.personId,
          propertyId,
        })
        .returning();
      await tx.insert(pqrStatusHistory).values({
        tenantId: tenant.tenantId,
        pqrId: pqr!.id,
        toStatus: 'pending_review',
        changedBy: tenant.userId,
      });
      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: 'pqr.created',
        entityType: 'pqr',
        entityId: pqr!.id,
        summary: `Radicó la solicitud ${filingNumber}`,
        meta,
      });
      await this.notifyRequester(tx, tenant, pqr!, `created`, {
        subject: `Recibimos tu solicitud ${filingNumber}`,
        message: 'Recibimos tu solicitud. La administración la revisará y te responderá por este medio.',
      });
      return this.detail(tx, tenant, pqr!.id);
    });
  }

  // ----------------------------------------------------------- conversación

  async comment(tenant: TenantContext, pqrId: string, input: PqrCommentDto, meta: RequestMeta): Promise<PqrDetail> {
    return this.database.tenant(tenant, async (tx) => {
      const pqr = await this.findVisible(tx, tenant, pqrId, { lock: true });
      const isStaff = this.canManage(tenant, pqr);
      const isRequester = pqr.requesterUserId === tenant.userId;
      if (!isStaff && !isRequester) throw AppError.forbidden();
      if (pqr.status === 'closed') {
        throw AppError.conflict('PQR_CLOSED', 'Esta solicitud está cerrada. Si necesitas algo más, radica una nueva.');
      }
      // Solo el personal puede escribir notas internas; a un residente se le ignora la marca.
      const isInternal = isStaff && input.isInternal;

      const [comment] = await tx
        .insert(pqrComments)
        .values({ tenantId: tenant.tenantId, pqrId, authorUserId: tenant.userId, body: input.body, isInternal })
        .returning({ id: pqrComments.id });

      if (isStaff && !isInternal) {
        const firstResponse = pqr.firstResponseAt === null;
        if (firstResponse) await tx.update(pqrs).set({ firstResponseAt: new Date() }).where(eq(pqrs.id, pqrId));
        // La primera respuesta de la administración pone la solicitud en trámite.
        if (pqr.status === 'pending_review') await this.changeStatus(tx, tenant, pqr, 'in_progress', undefined);
        else await tx.update(pqrs).set({ updatedAt: new Date() }).where(eq(pqrs.id, pqrId));
        await this.notifyRequester(tx, tenant, pqr, `comment:${comment!.id}`, {
          subject: `Nueva respuesta en tu solicitud ${pqr.filingNumber}`,
          message: 'La administración respondió tu solicitud.',
          status: pqr.status === 'pending_review' ? 'in_progress' : pqr.status,
        });
      } else if (!isStaff) {
        await tx.update(pqrs).set({ updatedAt: new Date() }).where(eq(pqrs.id, pqrId));
        await this.notifyStaff(tx, tenant, pqr, `comment:${comment!.id}`);
      }

      await this.audit.record(tx, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: isInternal ? 'pqr.internal_note_added' : 'pqr.comment_added',
        entityType: 'pqr',
        entityId: pqrId,
        summary: `${isInternal ? 'Agregó una nota interna' : 'Escribió'} en ${pqr.filingNumber}`,
        meta,
      });
      return this.detail(tx, tenant, pqrId);
    });
  }

  // ---------------------------------------------------------------- gestión

  async update(tenant: TenantContext, pqrId: string, input: UpdatePqrDto, meta: RequestMeta): Promise<PqrDetail> {
    return this.database.tenant(tenant, async (tx) => {
      const pqr = await this.findVisible(tx, tenant, pqrId, { lock: true });
      if (!this.canManage(tenant, pqr)) throw AppError.forbidden();
      const changes: string[] = [];

      if (input.assigneeUserId !== undefined && input.assigneeUserId !== pqr.assigneeUserId) {
        // Asignar o reasignar es de quien gestiona todas las PQR, no de quien solo gestiona las suyas.
        if (!tenant.permissions.has('pqr.manage')) throw AppError.forbidden();
        let name = 'nadie';
        if (input.assigneeUserId) {
          const candidate = (await this.staff(tx)).find((item) => item.userId === input.assigneeUserId);
          if (!candidate) {
            throw AppError.unprocessable('ASSIGNEE_NOT_ALLOWED', 'Esa persona no puede gestionar PQR en este conjunto.', {
              fields: { assigneeUserId: 'Selecciona a alguien del equipo' },
            });
          }
          name = candidate.name;
        }
        await tx.update(pqrs).set({ assigneeUserId: input.assigneeUserId }).where(eq(pqrs.id, pqrId));
        changes.push(`asignó a ${name}`);
      }

      if (input.priority && input.priority !== pqr.priority) {
        await tx.update(pqrs).set({ priority: input.priority }).where(eq(pqrs.id, pqrId));
        changes.push('cambió la prioridad');
      }

      if (input.status && input.status !== pqr.status) {
        if (!PQR_TRANSITIONS[pqr.status].includes(input.status)) {
          throw AppError.conflict(
            'INVALID_STATUS_CHANGE',
            `Una solicitud ${PQR_STATUS_LABELS[pqr.status].toLowerCase()} no puede pasar a ${PQR_STATUS_LABELS[input.status].toLowerCase()}.`,
          );
        }
        const historyId = await this.changeStatus(tx, tenant, pqr, input.status, input.note);
        changes.push(`cambió el estado a ${PQR_STATUS_LABELS[input.status].toLowerCase()}`);
        const messages: Partial<Record<PqrStatus, { subject: string; message: string }>> = {
          resolved: {
            subject: `Tu solicitud ${pqr.filingNumber} fue resuelta`,
            message: 'La administración marcó tu solicitud como resuelta. Si no quedaste conforme, responde en la conversación.',
          },
          closed: {
            subject: `Tu solicitud ${pqr.filingNumber} fue cerrada`,
            message: 'Tu solicitud quedó cerrada. Si necesitas algo más, puedes radicar una nueva.',
          },
        };
        const text = messages[input.status] ?? {
          subject: `Tu solicitud ${pqr.filingNumber} cambió de estado`,
          message: `Tu solicitud ahora está ${PQR_STATUS_LABELS[input.status].toLowerCase()}.`,
        };
        await this.notifyRequester(tx, tenant, pqr, `status:${historyId}`, {
          subject: text.subject,
          message: input.note ? `${text.message} Nota de la administración: ${input.note}` : text.message,
          status: input.status,
        });
      }

      if (changes.length > 0) {
        await this.audit.record(tx, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          action: 'pqr.updated',
          entityType: 'pqr',
          entityId: pqrId,
          summary: `En ${pqr.filingNumber}: ${changes.join(', ')}`,
          changes: { ...input },
          meta,
        });
      }
      return this.detail(tx, tenant, pqrId);
    });
  }

  // ---------------------------------------------------------------- reportes

  async report(tenant: TenantContext, query: PqrReportQueryDto): Promise<PqrReport> {
    return this.database.tenant(tenant, async (tx) => {
      const timezone = await this.timezone(tx, tenant);
      // Todos los indicadores parten del mismo grupo: las PQR radicadas en el periodo.
      const cohort = sql`(p.created_at AT TIME ZONE ${timezone})::date BETWEEN ${query.from}::date AND ${query.to}::date`;
      const rows = async <T extends Record<string, unknown>>(statement: SQL) => (await tx.execute<T>(statement)).rows;

      const [totals] = await rows<{ received: number; pending: number; resolved: number; first: number | null; resolution: number | null }>(sql`
        SELECT count(*)::int AS received,
               count(*) FILTER (WHERE p.status IN ('pending_review', 'in_progress'))::int AS pending,
               count(*) FILTER (WHERE p.status IN ('resolved', 'closed'))::int AS resolved,
               round((avg(extract(epoch FROM p.first_response_at - p.created_at)) / 3600)::numeric, 1)::float AS first,
               round((avg(extract(epoch FROM p.resolved_at - p.created_at)) / 3600)::numeric, 1)::float AS resolution
        FROM pqrs p WHERE ${cohort}`);
      const byStatus = await rows<{ status: PqrStatus; count: number }>(
        sql`SELECT p.status, count(*)::int AS count FROM pqrs p WHERE ${cohort} GROUP BY p.status`,
      );
      const byType = await rows<{ type: PqrType; count: number }>(
        sql`SELECT p.type, count(*)::int AS count FROM pqrs p WHERE ${cohort} GROUP BY p.type ORDER BY count DESC`,
      );
      const byCategory = await rows<{ label: string; count: number }>(
        sql`SELECT p.category AS label, count(*)::int AS count FROM pqrs p WHERE ${cohort} GROUP BY p.category ORDER BY count DESC, label`,
      );
      const byTower = await rows<{ label: string; count: number }>(sql`
        SELECT coalesce(t.name, CASE WHEN p.property_id IS NULL THEN 'Sin unidad' ELSE 'Sin torre' END) AS label,
               count(*)::int AS count
        FROM pqrs p
        LEFT JOIN properties pr ON pr.id = p.property_id
        LEFT JOIN towers t ON t.id = pr.tower_id
        WHERE ${cohort} GROUP BY 1 ORDER BY count DESC, label`);
      const trend = await rows<{ month: string; received: number; resolved: number }>(sql`
        SELECT to_char(date_trunc('month', p.created_at AT TIME ZONE ${timezone}), 'YYYY-MM') AS month,
               count(*)::int AS received,
               count(*) FILTER (WHERE p.status IN ('resolved', 'closed'))::int AS resolved
        FROM pqrs p WHERE ${cohort} GROUP BY 1 ORDER BY 1`);

      return {
        from: query.from,
        to: query.to,
        received: totals?.received ?? 0,
        pending: totals?.pending ?? 0,
        resolved: totals?.resolved ?? 0,
        avgFirstResponseHours: totals?.first ?? null,
        avgResolutionHours: totals?.resolution ?? null,
        byStatus,
        byType,
        byCategory,
        byTower,
        trend,
      };
    });
  }

  // ---------------------------------------------------------------- internos

  private assertStaff(tenant: TenantContext): void {
    if (!tenant.permissions.has('pqr.read_all')) throw AppError.forbidden();
  }

  /** Qué PQR puede ver quien consulta: todas, o solo las que radicó. */
  private visibility(tenant: TenantContext): SQL | undefined {
    if (tenant.permissions.has('pqr.read_all')) return undefined;
    if (tenant.permissions.has('pqr.read_own')) return eq(pqrs.requesterUserId, tenant.userId);
    throw AppError.forbidden();
  }

  private canManage(tenant: TenantContext, pqr: Pqr): boolean {
    if (tenant.permissions.has('pqr.manage')) return true;
    return tenant.permissions.has('pqr.manage_assigned') && pqr.assigneeUserId === tenant.userId;
  }

  private async findVisible(tx: Tx, tenant: TenantContext, pqrId: string, options: { lock?: boolean } = {}): Promise<Pqr> {
    const query = tx
      .select()
      .from(pqrs)
      .where(and(eq(pqrs.id, pqrId), this.visibility(tenant)));
    const [pqr] = options.lock ? await query.for('update') : await query;
    // Una PQR ajena responde igual que una inexistente.
    if (!pqr) throw AppError.notFound('No encontramos esta solicitud.');
    return pqr;
  }

  /** Cambia el estado, fija las fechas que alimentan los indicadores y deja el historial. */
  private async changeStatus(tx: Tx, tenant: TenantContext, pqr: Pqr, to: PqrStatus, note: string | undefined) {
    const now = new Date();
    await tx
      .update(pqrs)
      .set({
        status: to,
        resolvedAt: to === 'resolved' ? now : to === 'in_progress' ? null : pqr.resolvedAt,
        closedAt: to === 'closed' ? now : null,
      })
      .where(eq(pqrs.id, pqr.id));
    const [history] = await tx
      .insert(pqrStatusHistory)
      .values({ tenantId: tenant.tenantId, pqrId: pqr.id, fromStatus: pqr.status, toStatus: to, changedBy: tenant.userId, note })
      .returning({ id: pqrStatusHistory.id });
    return history!.id;
  }

  private selectItems(tx: Tx) {
    return tx
      .select({
        id: pqrs.id,
        filingNumber: pqrs.filingNumber,
        type: pqrs.type,
        category: pqrs.category,
        subject: pqrs.subject,
        priority: pqrs.priority,
        status: pqrs.status,
        requesterName: users.displayName,
        propertyKind: properties.kind,
        propertyNumber: properties.number,
        towerName: towers.name,
        assigneeUserId: pqrs.assigneeUserId,
        assigneeName: assignee.displayName,
        createdAt: pqrs.createdAt,
        updatedAt: pqrs.updatedAt,
        description: pqrs.description,
        firstResponseAt: pqrs.firstResponseAt,
        resolvedAt: pqrs.resolvedAt,
        closedAt: pqrs.closedAt,
        requesterUserId: pqrs.requesterUserId,
      })
      .from(pqrs)
      .innerJoin(users, eq(users.id, pqrs.requesterUserId))
      .leftJoin(assignee, eq(assignee.id, pqrs.assigneeUserId))
      .leftJoin(properties, eq(properties.id, pqrs.propertyId))
      .leftJoin(towers, eq(towers.id, properties.towerId))
      .$dynamic();
  }

  private async detail(tx: Tx, tenant: TenantContext, pqrId: string): Promise<PqrDetail> {
    const [row] = await this.selectItems(tx).where(and(eq(pqrs.id, pqrId), this.visibility(tenant)));
    if (!row) throw AppError.notFound('No encontramos esta solicitud.');
    const canManage =
      tenant.permissions.has('pqr.manage') ||
      (tenant.permissions.has('pqr.manage_assigned') && row.assigneeUserId === tenant.userId);
    const seesInternal = tenant.permissions.has('pqr.read_all');

    const comments = await tx
      .select({
        id: pqrComments.id,
        authorUserId: pqrComments.authorUserId,
        authorName: users.displayName,
        body: pqrComments.body,
        isInternal: pqrComments.isInternal,
        createdAt: pqrComments.createdAt,
      })
      .from(pqrComments)
      .innerJoin(users, eq(users.id, pqrComments.authorUserId))
      .where(
        and(
          eq(pqrComments.pqrId, pqrId),
          // Las notas internas nunca salen de la base de datos hacia un residente.
          seesInternal ? undefined : eq(pqrComments.isInternal, false),
        ),
      )
      .orderBy(asc(pqrComments.createdAt));
    const history = await tx
      .select({
        id: pqrStatusHistory.id,
        fromStatus: pqrStatusHistory.fromStatus,
        toStatus: pqrStatusHistory.toStatus,
        changedByName: users.displayName,
        note: pqrStatusHistory.note,
        createdAt: pqrStatusHistory.createdAt,
      })
      .from(pqrStatusHistory)
      .leftJoin(users, eq(users.id, pqrStatusHistory.changedBy))
      .where(eq(pqrStatusHistory.pqrId, pqrId))
      .orderBy(asc(pqrStatusHistory.createdAt));

    const iso = (value: Date | null) => value?.toISOString() ?? null;
    return {
      ...toListItem(row),
      description: row.description,
      firstResponseAt: iso(row.firstResponseAt),
      resolvedAt: iso(row.resolvedAt),
      closedAt: iso(row.closedAt),
      comments: comments.map(({ authorUserId, createdAt, ...comment }) => ({
        ...comment,
        fromStaff: authorUserId !== row.requesterUserId,
        createdAt: createdAt.toISOString(),
      })),
      history: history.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      canManage,
      canComment: row.status !== 'closed' && (canManage || row.requesterUserId === tenant.userId),
    };
  }

  /** Miembros activos cuyo rol permite gestionar PQR. */
  private async staff(tx: Tx): Promise<PqrAssignee[]> {
    const rows = await tx
      .selectDistinct({ userId: users.id, name: users.displayName })
      .from(userTenantMemberships)
      .innerJoin(users, eq(users.id, userTenantMemberships.userId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userTenantMemberships.roleId))
      .where(
        and(
          eq(userTenantMemberships.status, 'active'),
          eq(users.status, 'active'),
          inArray(rolePermissions.permissionKey, ['pqr.manage', 'pqr.manage_assigned']),
        ),
      )
      .orderBy(users.displayName);
    return rows;
  }

  private async timezone(tx: Tx, tenant: TenantContext): Promise<string> {
    const [settings] = await tx
      .select({ timezone: tenantSettings.timezone })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.tenantId));
    return settings?.timezone ?? DEFAULT_TIMEZONE;
  }

  private async link(tx: Tx, tenant: TenantContext, pqrId: string) {
    const [row] = await tx.select({ slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, tenant.tenantId));
    return { brandName: row?.name ?? 'Brisas', url: `${this.config.webUrl}/c/${row?.slug ?? ''}/pqr/${pqrId}` };
  }

  /** Correo al solicitante. La clave de idempotencia identifica el hecho que lo origina. */
  private async notifyRequester(
    tx: Tx,
    tenant: TenantContext,
    pqr: Pqr,
    event: string,
    text: { subject: string; message: string; status?: PqrStatus },
  ): Promise<void> {
    const [requester] = await tx.select().from(users).where(eq(users.id, pqr.requesterUserId));
    if (!requester) return;
    const { brandName, url } = await this.link(tx, tenant, pqr.id);
    await this.mail.enqueue(tx, {
      tenantId: tenant.tenantId,
      templateKey: 'pqr.update',
      recipient: requester.email,
      idempotencyKey: `pqr:${pqr.id}:${event}`,
      payload: {
        name: requester.displayName,
        brandName,
        subject: text.subject,
        message: text.message,
        filingNumber: pqr.filingNumber,
        pqrSubject: pqr.subject,
        status: PQR_STATUS_LABELS[text.status ?? pqr.status],
        link: url,
      },
    });
  }

  /** Aviso al responsable de la PQR o, si no tiene, a quienes gestionan todas. */
  private async notifyStaff(tx: Tx, tenant: TenantContext, pqr: Pqr, event: string): Promise<void> {
    const recipients = pqr.assigneeUserId
      ? await tx.select({ id: users.id, email: users.email, name: users.displayName }).from(users).where(eq(users.id, pqr.assigneeUserId))
      : await tx
          .selectDistinct({ id: users.id, email: users.email, name: users.displayName })
          .from(userTenantMemberships)
          .innerJoin(users, eq(users.id, userTenantMemberships.userId))
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, userTenantMemberships.roleId))
          .where(
            and(
              eq(userTenantMemberships.status, 'active'),
              eq(users.status, 'active'),
              eq(rolePermissions.permissionKey, 'pqr.manage'),
            ),
          );
    const { brandName, url } = await this.link(tx, tenant, pqr.id);
    for (const recipient of recipients) {
      await this.mail.enqueue(tx, {
        tenantId: tenant.tenantId,
        templateKey: 'pqr.update',
        recipient: recipient.email,
        idempotencyKey: `pqr:${pqr.id}:${event}:${recipient.id}`,
        payload: {
          name: recipient.name,
          brandName,
          subject: `Nuevo comentario en la solicitud ${pqr.filingNumber}`,
          message: 'El residente agregó un comentario a su solicitud.',
          filingNumber: pqr.filingNumber,
          pqrSubject: pqr.subject,
          status: PQR_STATUS_LABELS[pqr.status],
          link: url,
        },
      });
    }
  }
}

function toListItem(row: {
  id: string;
  filingNumber: string;
  type: PqrType;
  category: string;
  subject: string;
  priority: PqrListItem['priority'];
  status: PqrStatus;
  requesterName: string;
  propertyKind: 'apartment' | 'house' | 'commercial' | null;
  propertyNumber: string | null;
  towerName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PqrListItem {
  return {
    id: row.id,
    filingNumber: row.filingNumber,
    type: row.type,
    category: row.category,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    requesterName: row.requesterName,
    propertyLabel:
      row.propertyKind && row.propertyNumber ? propertyLabel(row.propertyKind, row.propertyNumber, row.towerName) : null,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assigneeName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
