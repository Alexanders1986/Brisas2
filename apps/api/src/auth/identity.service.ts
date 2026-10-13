import type { RoleKey } from '@brisas/contracts';
import { authTokens, roles, userTenantMemberships, users } from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import type { Tx } from '../database/database.service';
import { MailQueueService } from '../notifications/mail-queue.service';
import { generateToken, sha256 } from './crypto';

export const INVITATION_TTL_DAYS = 7;
export const PASSWORD_RESET_TTL_MINUTES = 60;

type User = typeof users.$inferSelect;

/**
 * Operaciones sobre cuentas que comparten varios módulos (residentes, conjuntos, auth):
 * crear la cuenta de una persona invitada, darle un rol en un conjunto e invitarla.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly config: AppConfig,
    private readonly mail: MailQueueService,
  ) {}

  async findUserByEmail(tx: Tx, email: string): Promise<User | undefined> {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    return user;
  }

  /** Devuelve la cuenta asociada al correo; si no existe la crea en estado "invitada". */
  async ensureUser(tx: Tx, input: { email: string; displayName: string }): Promise<{ user: User; created: boolean }> {
    const existing = await this.findUserByEmail(tx, input.email);
    if (existing) return { user: existing, created: false };
    const [user] = await tx
      .insert(users)
      .values({ email: input.email.toLowerCase(), displayName: input.displayName, status: 'invited' })
      .returning();
    return { user: user!, created: true };
  }

  /** Asigna el rol al usuario en el conjunto, o lo reactiva si estaba suspendido. */
  async ensureMembership(
    tx: Tx,
    input: { tenantId: string; userId: string; roleKey: RoleKey; createdBy: string | null },
  ): Promise<void> {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.tenantId), eq(roles.key, input.roleKey)));
    if (!role) throw new Error(`Falta el rol del sistema ${input.roleKey}; ejecuta las migraciones.`);
    await tx
      .insert(userTenantMemberships)
      .values({ tenantId: input.tenantId, userId: input.userId, roleId: role.id, createdBy: input.createdBy })
      .onConflictDoUpdate({
        target: [userTenantMemberships.userId, userTenantMemberships.tenantId, userTenantMemberships.roleId],
        set: { status: 'active', updatedAt: new Date() },
      });
  }

  /** Cambia el estado de las membresías del usuario en el conjunto para los roles dados. */
  async setMembershipStatus(
    tx: Tx,
    input: { tenantId: string; userId: string; roleKeys: readonly RoleKey[]; status: 'active' | 'suspended' },
  ): Promise<number> {
    const roleRows = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.tenantId), inArray(roles.key, [...input.roleKeys])));
    if (roleRows.length === 0) return 0;
    const updated = await tx
      .update(userTenantMemberships)
      .set({ status: input.status })
      .where(
        and(
          eq(userTenantMemberships.tenantId, input.tenantId),
          eq(userTenantMemberships.userId, input.userId),
          inArray(
            userTenantMemberships.roleId,
            roleRows.map((role) => role.id),
          ),
        ),
      )
      .returning({ id: userTenantMemberships.id });
    return updated.length;
  }

  /**
   * Genera un enlace de invitación de un solo uso y encola el correo.
   * Las invitaciones anteriores del usuario quedan anuladas.
   */
  async issueInvitation(tx: Tx, input: { user: User; tenantId: string | null; brandName: string }): Promise<void> {
    await this.invalidateTokens(tx, input.user.id, 'invitation');
    const token = generateToken();
    const [row] = await tx
      .insert(authTokens)
      .values({
        userId: input.user.id,
        tenantId: input.tenantId,
        purpose: 'invitation',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning({ id: authTokens.id });
    await this.mail.enqueue(tx, {
      tenantId: input.tenantId,
      templateKey: 'auth.invitation',
      recipient: input.user.email,
      idempotencyKey: `auth.invitation:${row!.id}`,
      payload: {
        name: input.user.displayName,
        brandName: input.brandName,
        link: `${this.config.webUrl}/invitacion?token=${token}`,
        expiresIn: `${INVITATION_TTL_DAYS} días`,
      },
    });
  }

  async issuePasswordReset(tx: Tx, user: User): Promise<void> {
    await this.invalidateTokens(tx, user.id, 'password_reset');
    const token = generateToken();
    const [row] = await tx
      .insert(authTokens)
      .values({
        userId: user.id,
        purpose: 'password_reset',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      })
      .returning({ id: authTokens.id });
    await this.mail.enqueue(tx, {
      tenantId: null,
      templateKey: 'auth.password_reset',
      recipient: user.email,
      idempotencyKey: `auth.password_reset:${row!.id}`,
      payload: {
        name: user.displayName,
        brandName: 'Brisas',
        link: `${this.config.webUrl}/restablecer?token=${token}`,
        expiresIn: `${PASSWORD_RESET_TTL_MINUTES} minutos`,
      },
    });
  }

  async invalidateTokens(tx: Tx, userId: string, purpose: 'invitation' | 'password_reset'): Promise<void> {
    await tx
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)));
  }
}
