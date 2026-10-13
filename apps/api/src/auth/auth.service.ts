import {
  type AuthTokensResponse,
  type InvitationPreview,
  type MeResponse,
  type MfaEnabledResponse,
  type MfaSetupResponse,
  PRIVACY_POLICY_VERSION,
  type SessionSummary,
} from '@brisas/contracts';
import {
  authTokens,
  consents,
  hashPassword,
  tenants,
  userSessions,
  users,
  verifyPassword,
} from '@brisas/database';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { AuthContext, RequestMeta } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { DatabaseService, type Tx } from '../database/database.service';
import { AccessService } from './access.service';
import type { AccessTokenPayload } from './auth.guard';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateToken,
  generateTotpSecret,
  hashRecoveryCode,
  sha256,
  totpUri,
  verifyTotp,
} from './crypto';
import { IdentityService } from './identity.service';

type User = typeof users.$inferSelect;
type ClientType = 'web' | 'mobile';

export interface IssuedSession extends AuthTokensResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginOutcome =
  | { status: 'authenticated'; session: IssuedSession }
  | { status: 'mfa_required'; challengeToken: string };

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MFA_CHALLENGE_TTL_SECONDS = 300;
/** Ventana en la que un refresh token recién rotado se considera carrera entre pestañas y no robo. */
const REFRESH_RACE_WINDOW_MS = 20_000;

const INVALID_CREDENTIALS = () => AppError.unauthorized('INVALID_CREDENTIALS', 'El correo o la contraseña no son correctos.');
const ACCOUNT_LOCKED = () =>
  AppError.tooManyRequests(
    'ACCOUNT_LOCKED',
    `Por seguridad bloqueamos el acceso durante ${LOCK_MINUTES} minutos. Inténtalo más tarde o restablece tu contraseña.`,
  );
const INVALID_LINK = () =>
  AppError.badRequest('INVALID_OR_EXPIRED_TOKEN', 'El enlace no es válido o ya venció. Solicita uno nuevo.');

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ login

  async login(input: { email: string; password: string; client: ClientType }, meta: RequestMeta): Promise<LoginOutcome> {
    // El resultado se calcula dentro de la transacción y el error se lanza fuera,
    // para que el conteo de intentos fallidos quede guardado aunque el login falle.
    const outcome = await this.database.system(async (tx) => {
      const user = await this.identity.findUserByEmail(tx, input.email);
      if (!user?.passwordHash) {
        // Mismo costo de cómputo exista o no la cuenta: no se revela qué correos están registrados.
        await verifyPassword(await this.getDummyHash(), input.password);
        return { error: INVALID_CREDENTIALS() };
      }
      if (this.isLocked(user)) return { error: ACCOUNT_LOCKED() };

      if (!(await verifyPassword(user.passwordHash, input.password))) {
        const locked = await this.registerFailure(tx, user, meta);
        return { error: locked ? ACCOUNT_LOCKED() : INVALID_CREDENTIALS() };
      }
      if (user.status !== 'active') {
        return {
          error: AppError.forbidden('ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Comunícate con la administración.'),
        };
      }
      if (user.mfaEnabled) {
        const challengeToken = await this.jwt.signAsync(
          { sub: user.id, typ: 'mfa', client: input.client },
          { expiresIn: MFA_CHALLENGE_TTL_SECONDS },
        );
        return { result: { status: 'mfa_required', challengeToken } as const };
      }
      const session = await this.startSession(tx, user, input.client, meta);
      return { result: { status: 'authenticated', session } as const };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }

  async verifyMfaLogin(input: { challengeToken: string; code: string; client: ClientType }, meta: RequestMeta) {
    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(input.challengeToken);
      if (payload.typ !== 'mfa') throw new Error('tipo de token inesperado');
      userId = payload.sub;
    } catch {
      throw AppError.unauthorized('MFA_CHALLENGE_EXPIRED', 'La verificación venció. Inicia sesión de nuevo.');
    }

    const outcome = await this.database.system(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'active' || !user.mfaEnabled || !user.mfaSecretEncrypted) {
        return { error: AppError.unauthorized() };
      }
      if (this.isLocked(user)) return { error: ACCOUNT_LOCKED() };

      const code = input.code.trim();
      let valid = false;
      if (/^\d{6}$/.test(code)) {
        valid = verifyTotp(decryptSecret(user.mfaSecretEncrypted, this.config.dataEncryptionKey), code);
      } else {
        const hash = hashRecoveryCode(code);
        if (user.mfaRecoveryCodeHashes.includes(hash)) {
          valid = true;
          // Cada código de recuperación sirve una sola vez.
          await tx
            .update(users)
            .set({ mfaRecoveryCodeHashes: user.mfaRecoveryCodeHashes.filter((item) => item !== hash) })
            .where(eq(users.id, user.id));
          await this.audit.record(tx, {
            tenantId: null,
            actorUserId: user.id,
            action: 'auth.recovery_code_used',
            entityType: 'user',
            entityId: user.id,
            summary: 'Usó un código de recuperación para iniciar sesión',
            meta,
          });
        }
      }
      if (!valid) {
        const locked = await this.registerFailure(tx, user, meta);
        return {
          error: locked
            ? ACCOUNT_LOCKED()
            : AppError.unauthorized('INVALID_MFA_CODE', 'El código no es correcto. Revisa tu aplicación e inténtalo de nuevo.'),
        };
      }
      return { session: await this.startSession(tx, user, input.client, meta) };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.session;
  }

  // --------------------------------------------------------------- sesiones

  /** Rota el refresh token: el anterior deja de servir y se entrega uno nuevo. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
    const tokenHash = sha256(refreshToken);
    const outcome = await this.database.system(async (tx) => {
      const [session] = await tx
        .select()
        .from(userSessions)
        .where(or(eq(userSessions.refreshTokenHash, tokenHash), eq(userSessions.previousTokenHash, tokenHash)))
        .for('update');
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return { error: AppError.unauthorized() };

      if (session.refreshTokenHash !== tokenHash) {
        // Llegó un token que ya había sido rotado.
        if (Date.now() - session.lastUsedAt.getTime() < REFRESH_RACE_WINDOW_MS) {
          return {
            error: AppError.conflict('REFRESH_IN_PROGRESS', 'La sesión se está renovando. Reintenta en un momento.'),
          };
        }
        // Fuera de la ventana de carrera es señal de robo: se invalida la sesión completa.
        await tx
          .update(userSessions)
          .set({ revokedAt: new Date(), revokedReason: 'reuse_detected' })
          .where(eq(userSessions.id, session.id));
        await this.audit.record(tx, {
          tenantId: null,
          actorUserId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'session',
          entityId: session.id,
          summary: 'Se detectó la reutilización de un token de sesión y la sesión fue cerrada',
          meta,
        });
        return { error: AppError.unauthorized() };
      }

      const [user] = await tx.select().from(users).where(eq(users.id, session.userId));
      if (!user || user.status !== 'active') return { error: AppError.unauthorized() };

      const next = generateToken();
      const refreshExpiresAt = this.refreshExpiry();
      await tx
        .update(userSessions)
        .set({
          refreshTokenHash: sha256(next),
          previousTokenHash: tokenHash,
          lastUsedAt: new Date(),
          expiresAt: refreshExpiresAt,
          ip: meta.ip,
          userAgent: meta.userAgent,
        })
        .where(eq(userSessions.id, session.id));
      return { session: await this.buildTokens(user.id, session.id, next, refreshExpiresAt) };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.session;
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.database.system((tx) => this.revokeSessions(tx, auth.userId, 'logout', { only: auth.sessionId }));
  }

  async listSessions(auth: AuthContext): Promise<SessionSummary[]> {
    const rows = await this.database.system((tx) =>
      tx
        .select()
        .from(userSessions)
        .where(
          and(eq(userSessions.userId, auth.userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())),
        )
        .orderBy(desc(userSessions.lastUsedAt)),
    );
    return rows.map((row) => ({
      id: row.id,
      current: row.id === auth.sessionId,
      client: row.client,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
    }));
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    const revoked = await this.database.system((tx) =>
      this.revokeSessions(tx, auth.userId, 'revoked_by_user', { only: sessionId }),
    );
    // Se filtra por el usuario autenticado: no es posible cerrar sesiones ajenas adivinando ids.
    if (revoked === 0) throw AppError.notFound('No encontramos esa sesión.');
  }

  async revokeOtherSessions(auth: AuthContext): Promise<{ revoked: number }> {
    const revoked = await this.database.system((tx) =>
      this.revokeSessions(tx, auth.userId, 'revoked_by_user', { except: auth.sessionId }),
    );
    return { revoked };
  }

  // -------------------------------------------------------------------- yo

  async me(auth: AuthContext): Promise<MeResponse> {
    return this.database.system(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, auth.userId));
      if (!user) throw AppError.unauthorized();
      const memberships = await this.access.memberships(tx, user.id);
      const isStaff = user.isPlatformAdmin || memberships.some((item) => AccessService.hasStaffRole(item.roles));
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        mfaEnabled: user.mfaEnabled,
        mfaEnrollmentRequired: this.config.mfaRequiredForAdmins && isStaff && !user.mfaEnabled,
        memberships,
      };
    });
  }

  // ------------------------------------------------------------ contraseñas

  /** Siempre responde igual, exista o no la cuenta, para no revelar correos registrados. */
  async forgotPassword(email: string): Promise<void> {
    await this.database.system(async (tx) => {
      const user = await this.identity.findUserByEmail(tx, email);
      if (!user || user.status === 'disabled') return;
      if (user.status === 'invited') {
        // Aún no ha activado la cuenta: se reenvía la invitación en lugar de un restablecimiento.
        await this.identity.issueInvitation(tx, { user, tenantId: null, brandName: 'Brisas' });
        return;
      }
      await this.identity.issuePasswordReset(tx, user);
    });
  }

  async resetPassword(input: { token: string; password: string }, meta: RequestMeta): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await this.database.system(async (tx) => {
      const token = await this.consumeToken(tx, input.token, 'password_reset');
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, token.userId));
      // Quien tuviera una sesión abierta con la contraseña anterior queda fuera.
      await this.revokeSessions(tx, token.userId, 'password_reset');
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: token.userId,
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: token.userId,
        summary: 'Restableció su contraseña con un enlace de recuperación',
        meta,
      });
    });
  }

  async changePassword(auth: AuthContext, input: { currentPassword: string; newPassword: string }, meta: RequestMeta) {
    const user = await this.database.system(async (tx) => (await tx.select().from(users).where(eq(users.id, auth.userId)))[0]);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw AppError.badRequest('INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta.', {
        fields: { currentPassword: 'La contraseña actual no es correcta' },
      });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.database.system(async (tx) => {
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, auth.userId));
      await this.revokeSessions(tx, auth.userId, 'password_changed', { except: auth.sessionId });
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: auth.userId,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: auth.userId,
        summary: 'Cambió su contraseña',
        meta,
      });
    });
  }

  // ------------------------------------------------------------ invitaciones

  async previewInvitation(rawToken: string): Promise<InvitationPreview> {
    return this.database.system(async (tx) => {
      const [row] = await tx
        .select({ email: users.email, tenantName: tenants.name })
        .from(authTokens)
        .innerJoin(users, eq(users.id, authTokens.userId))
        .leftJoin(tenants, eq(tenants.id, authTokens.tenantId))
        .where(
          and(
            eq(authTokens.tokenHash, sha256(rawToken)),
            eq(authTokens.purpose, 'invitation'),
            isNull(authTokens.consumedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        );
      if (!row) throw INVALID_LINK();
      return row;
    });
  }

  async acceptInvitation(input: { token: string; password: string }, meta: RequestMeta): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await this.database.system(async (tx) => {
      const token = await this.consumeToken(tx, input.token, 'invitation');
      await tx
        .update(users)
        .set({ passwordHash, status: 'active', passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(and(eq(users.id, token.userId), ne(users.status, 'disabled')));
      // Prueba de la autorización de tratamiento de datos (Ley 1581 de 2012).
      await tx.insert(consents).values({
        userId: token.userId,
        tenantId: token.tenantId,
        kind: 'data_treatment',
        policyVersion: PRIVACY_POLICY_VERSION,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: token.userId,
        action: 'auth.invitation_accepted',
        entityType: 'user',
        entityId: token.userId,
        summary: 'Activó su cuenta y aceptó la política de tratamiento de datos',
        meta,
      });
    });
  }

  // -------------------------------------------------------------------- MFA

  async setupMfa(auth: AuthContext): Promise<MfaSetupResponse> {
    return this.database.system(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, auth.userId));
      if (!user) throw AppError.unauthorized();
      if (user.mfaEnabled) {
        throw AppError.conflict('MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa.');
      }
      const secret = generateTotpSecret();
      await tx
        .update(users)
        .set({ mfaSecretEncrypted: encryptSecret(secret, this.config.dataEncryptionKey) })
        .where(eq(users.id, user.id));
      return { secret, otpauthUrl: totpUri(secret, user.email, 'Brisas') };
    });
  }

  async enableMfa(auth: AuthContext, code: string, meta: RequestMeta): Promise<MfaEnabledResponse> {
    return this.database.system(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, auth.userId)).for('update');
      if (!user) throw AppError.unauthorized();
      if (user.mfaEnabled) {
        throw AppError.conflict('MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa.');
      }
      if (!user.mfaSecretEncrypted) {
        throw AppError.badRequest('MFA_SETUP_REQUIRED', 'Primero genera el código QR para configurar tu aplicación.');
      }
      if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted, this.config.dataEncryptionKey), code)) {
        throw AppError.badRequest('INVALID_MFA_CODE', 'El código no es correcto. Revisa tu aplicación e inténtalo de nuevo.', {
          fields: { code: 'El código no es correcto' },
        });
      }
      const recoveryCodes = generateRecoveryCodes();
      await tx
        .update(users)
        .set({ mfaEnabled: true, mfaRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) })
        .where(eq(users.id, user.id));
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.mfa_enabled',
        entityType: 'user',
        entityId: user.id,
        summary: 'Activó la verificación en dos pasos',
        meta,
      });
      return { recoveryCodes };
    });
  }

  async disableMfa(auth: AuthContext, password: string, meta: RequestMeta): Promise<void> {
    const user = await this.database.system(async (tx) => (await tx.select().from(users).where(eq(users.id, auth.userId)))[0]);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw AppError.badRequest('INVALID_CURRENT_PASSWORD', 'La contraseña no es correcta.', {
        fields: { password: 'La contraseña no es correcta' },
      });
    }
    await this.database.system(async (tx) => {
      await tx
        .update(users)
        .set({ mfaEnabled: false, mfaSecretEncrypted: null, mfaRecoveryCodeHashes: [] })
        .where(eq(users.id, auth.userId));
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: auth.userId,
        action: 'auth.mfa_disabled',
        entityType: 'user',
        entityId: auth.userId,
        summary: 'Desactivó la verificación en dos pasos',
        meta,
      });
    });
  }

  // ---------------------------------------------------------------- internos

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(generateToken());
    return this.dummyHash;
  }

  private isLocked(user: User): boolean {
    return Boolean(user.lockedUntil && user.lockedUntil > new Date());
  }

  /** Cuenta el intento fallido y bloquea temporalmente la cuenta al superar el límite. */
  private async registerFailure(tx: Tx, user: User, meta: RequestMeta): Promise<boolean> {
    const previousLockExpired = Boolean(user.lockedUntil && user.lockedUntil <= new Date());
    const failedLoginCount = previousLockExpired ? 1 : user.failedLoginCount + 1;
    const locked = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await tx
      .update(users)
      .set({ failedLoginCount, lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(users.id, user.id));
    if (locked) {
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.account_locked',
        entityType: 'user',
        entityId: user.id,
        summary: `Cuenta bloqueada ${LOCK_MINUTES} minutos por intentos fallidos de inicio de sesión`,
        meta,
      });
    }
    return locked;
  }

  private async startSession(tx: Tx, user: User, client: ClientType, meta: RequestMeta): Promise<IssuedSession> {
    const refreshToken = generateToken();
    const refreshExpiresAt = this.refreshExpiry();
    const [session] = await tx
      .insert(userSessions)
      .values({
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        client,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: refreshExpiresAt,
      })
      .returning({ id: userSessions.id });
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    return this.buildTokens(user.id, session!.id, refreshToken, refreshExpiresAt);
  }

  private async buildTokens(userId: string, sessionId: string, refreshToken: string, refreshExpiresAt: Date) {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.accessTokenTtlSeconds });
    return { accessToken, expiresIn: this.config.accessTokenTtlSeconds, refreshToken, refreshExpiresAt };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }

  private async revokeSessions(
    tx: Tx,
    userId: string,
    reason: string,
    filter: { only?: string; except?: string } = {},
  ): Promise<number> {
    const revoked = await tx
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          filter.only ? eq(userSessions.id, filter.only) : undefined,
          filter.except ? ne(userSessions.id, filter.except) : undefined,
        ),
      )
      .returning({ id: userSessions.id });
    return revoked.length;
  }

  /** Valida y marca como usado un token de un solo uso. */
  private async consumeToken(tx: Tx, rawToken: string, purpose: 'password_reset' | 'invitation') {
    const [token] = await tx
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, sha256(rawToken)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .for('update');
    if (!token) throw INVALID_LINK();
    await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, token.id));
    return token;
  }
}
