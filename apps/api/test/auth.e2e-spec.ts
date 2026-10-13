import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import { totpCode } from '../src/auth/crypto';
import {
  API,
  PASSWORD,
  type Scenario,
  bearer,
  createScenario,
  createTestApp,
  flushMail,
  http,
  lastLinkToken,
  login,
} from './helpers';

describe('Autenticación', () => {
  let app: INestApplication;
  let scenario: Scenario;
  let pool: Pool;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    scenario = await createScenario(app);
    pool = scenario.pool;
    email = scenario.tenantA.adminEmail;
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  const unlock = () => pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = $1', [email]);

  describe('inicio de sesión', () => {
    it('rechaza credenciales incorrectas con el mismo mensaje exista o no la cuenta', async () => {
      const wrongPassword = await http(app).post(`${API}/auth/login`).send({ email, password: 'incorrecta-123' }).expect(401);
      const unknownUser = await http(app)
        .post(`${API}/auth/login`)
        .send({ email: 'nadie@pruebas.test', password: 'incorrecta-123' })
        .expect(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownUser.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: wrongPassword.body.error.message });
      await unlock();
    });

    it('valida el formato de los datos y devuelve errores por campo', async () => {
      const response = await http(app).post(`${API}/auth/login`).send({ email: 'no-es-correo', password: '' }).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(response.body.error.fields)).toEqual(expect.arrayContaining(['email', 'password']));
    });

    it('en web entrega el refresh token solo en una cookie httpOnly y SameSite=Strict', async () => {
      const response = await http(app).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
      expect(response.body.refreshToken).toBeUndefined();
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((item) => item.startsWith('brisas_rt='));
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('bloquea la cuenta tras cinco intentos fallidos, incluso con la contraseña correcta', async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await http(app).post(`${API}/auth/login`).send({ email, password: 'incorrecta-123' }).expect(401);
      }
      const fifth = await http(app).post(`${API}/auth/login`).send({ email, password: 'incorrecta-123' }).expect(429);
      expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
      await http(app).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(429);

      const audit = await pool.query(
        `SELECT 1 FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
         WHERE u.email = $1 AND a.action = 'auth.account_locked'`,
        [email],
      );
      expect(audit.rowCount).toBe(1);
      await unlock();
      await login(app, email);
    });
  });

  describe('rutas protegidas', () => {
    it('exigen un access token válido', async () => {
      await http(app).get(`${API}/auth/me`).expect(401);
      await http(app).get(`${API}/auth/me`).set('Authorization', 'Bearer no-es-un-token').expect(401);
    });

    it('no aceptan un token firmado con otro propósito', async () => {
      const { accessToken } = await login(app, email);
      const me = await http(app).get(`${API}/auth/me`).set(...bearer(accessToken)).expect(200);
      // Mismo secreto y usuario, pero tipo "mfa": no debe servir como access token.
      const challenge = await app.get(JwtService).signAsync({ sub: me.body.id, sid: 'x', typ: 'mfa' });
      await http(app).get(`${API}/auth/me`).set(...bearer(challenge)).expect(401);
    });

    it('devuelve los conjuntos, roles y permisos del usuario', async () => {
      const { accessToken } = await login(app, email);
      const me = await http(app).get(`${API}/auth/me`).set(...bearer(accessToken)).expect(200);
      expect(me.body).toMatchObject({ email, isPlatformAdmin: false, mfaEnabled: false });
      expect(me.body.memberships).toHaveLength(1);
      expect(me.body.memberships[0]).toMatchObject({ tenantId: scenario.tenantA.tenantId, roles: ['tenant_admin'] });
      expect(me.body.memberships[0].permissions).toContain('residents.manage');
      expect(me.body.passwordHash).toBeUndefined();
    });
  });

  describe('sesiones', () => {
    it('rota el refresh token y detecta la reutilización del anterior', async () => {
      const first = await login(app, email);
      const second = await http(app).post(`${API}/auth/refresh`).send({ refreshToken: first.refreshToken }).expect(200);
      expect(second.body.refreshToken).not.toBe(first.refreshToken);

      // Reuso inmediato: se trata como carrera entre pestañas, sin cerrar la sesión.
      const race = await http(app).post(`${API}/auth/refresh`).send({ refreshToken: first.refreshToken }).expect(409);
      expect(race.body.error.code).toBe('REFRESH_IN_PROGRESS');

      // Reuso tardío: señal de robo. Se cierra la sesión completa.
      await pool.query(`UPDATE user_sessions SET last_used_at = now() - interval '5 minutes' WHERE refresh_token_hash IS NOT NULL`);
      await http(app).post(`${API}/auth/refresh`).send({ refreshToken: first.refreshToken }).expect(401);
      await http(app).post(`${API}/auth/refresh`).send({ refreshToken: second.body.refreshToken }).expect(401);
      await http(app).get(`${API}/auth/me`).set(...bearer(second.body.accessToken)).expect(401);
    });

    it('exige el encabezado X-Brisas-Client al renovar con cookie (defensa CSRF)', async () => {
      const loginResponse = await http(app).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
      const cookie = (loginResponse.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const blocked = await http(app).post(`${API}/auth/refresh`).set('Cookie', cookie).send({}).expect(403);
      expect(blocked.body.error.code).toBe('CSRF_CHECK_FAILED');
      const allowed = await http(app)
        .post(`${API}/auth/refresh`)
        .set('Cookie', cookie)
        .set('X-Brisas-Client', 'web')
        .send({})
        .expect(200);
      expect(allowed.body.accessToken).toEqual(expect.any(String));
      expect(allowed.body.refreshToken).toBeUndefined();
    });

    it('cerrar sesión invalida de inmediato el access token', async () => {
      const { accessToken } = await login(app, email);
      await http(app).post(`${API}/auth/logout`).set(...bearer(accessToken)).expect(204);
      await http(app).get(`${API}/auth/me`).set(...bearer(accessToken)).expect(401);
    });

    it('permite listar y cerrar otras sesiones, pero no las de otro usuario', async () => {
      const mine = await login(app, email);
      const other = await login(app, email);
      const stranger = await login(app, scenario.tenantB.adminEmail);

      const sessions = await http(app).get(`${API}/account/sessions`).set(...bearer(mine.accessToken)).expect(200);
      expect(sessions.body.filter((item: { current: boolean }) => item.current)).toHaveLength(1);

      const strangerSessions = await http(app).get(`${API}/account/sessions`).set(...bearer(stranger.accessToken)).expect(200);
      await http(app)
        .delete(`${API}/account/sessions/${strangerSessions.body[0].id}`)
        .set(...bearer(mine.accessToken))
        .expect(404);
      await http(app).get(`${API}/auth/me`).set(...bearer(stranger.accessToken)).expect(200);

      const result = await http(app).post(`${API}/account/sessions/revoke-others`).set(...bearer(mine.accessToken)).expect(200);
      expect(result.body.revoked).toBeGreaterThanOrEqual(1);
      await http(app).get(`${API}/auth/me`).set(...bearer(other.accessToken)).expect(401);
      await http(app).get(`${API}/auth/me`).set(...bearer(mine.accessToken)).expect(200);
    });
  });

  describe('recuperación de contraseña', () => {
    it('responde igual para correos registrados y no registrados', async () => {
      await http(app).post(`${API}/auth/password/forgot`).send({ email: 'nadie@pruebas.test' }).expect(202);
      const before = (await flushMail(app)).length;
      await http(app).post(`${API}/auth/password/forgot`).send({ email: 'tampoco@pruebas.test' }).expect(202);
      expect((await flushMail(app)).length).toBe(before);
    });

    it('restablece la contraseña con un enlace de un solo uso y cierra las sesiones abiertas', async () => {
      const target = scenario.tenantB.adminEmail;
      const session = await login(app, target);
      await http(app).post(`${API}/auth/password/forgot`).send({ email: target }).expect(202);
      const token = await lastLinkToken(app, target);

      const weak = await http(app).post(`${API}/auth/password/reset`).send({ token, password: 'corta' }).expect(400);
      expect(weak.body.error.fields.password).toBeDefined();

      const newPassword = 'Nueva-Clave-2026';
      await http(app).post(`${API}/auth/password/reset`).send({ token, password: newPassword }).expect(204);
      await http(app).get(`${API}/auth/me`).set(...bearer(session.accessToken)).expect(401);
      await http(app).post(`${API}/auth/login`).send({ email: target, password: PASSWORD }).expect(401);
      await login(app, target, newPassword);

      const reused = await http(app).post(`${API}/auth/password/reset`).send({ token, password: 'Otra-Clave-2026' }).expect(400);
      expect(reused.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

      // El enlace no queda guardado en la cola después del envío, y el token solo existe como hash.
      const stored = await pool.query(`SELECT payload FROM notification_deliveries WHERE recipient = $1`, [target]);
      for (const row of stored.rows) expect(JSON.stringify(row.payload)).not.toContain(token);
      const tokens = await pool.query(`SELECT 1 FROM auth_tokens WHERE token_hash = $1`, [token]);
      expect(tokens.rowCount).toBe(0);
    });
  });

  describe('verificación en dos pasos', () => {
    it('activa MFA, lo exige al iniciar sesión y acepta un código de recuperación una sola vez', async () => {
      const { accessToken } = await login(app, email);
      const setup = await http(app).post(`${API}/account/mfa/setup`).set(...bearer(accessToken)).expect(200);
      expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

      await http(app).post(`${API}/account/mfa/enable`).set(...bearer(accessToken)).send({ code: '000000' }).expect(400);
      const enabled = await http(app)
        .post(`${API}/account/mfa/enable`)
        .set(...bearer(accessToken))
        .send({ code: totpCode(setup.body.secret) })
        .expect(200);
      expect(enabled.body.recoveryCodes).toHaveLength(8);

      // El secreto se guarda cifrado, nunca en claro.
      const stored = await pool.query('SELECT mfa_secret_encrypted FROM users WHERE email = $1', [email]);
      expect(stored.rows[0].mfa_secret_encrypted).not.toContain(setup.body.secret);

      const challenge = await http(app).post(`${API}/auth/login`).send({ email, password: PASSWORD, client: 'mobile' }).expect(200);
      expect(challenge.body).toEqual({ status: 'mfa_required', challengeToken: expect.any(String) });
      // El token de desafío no da acceso a la API.
      await http(app).get(`${API}/auth/me`).set(...bearer(challenge.body.challengeToken)).expect(401);

      const wrong = await http(app)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: challenge.body.challengeToken, code: '000000', client: 'mobile' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_MFA_CODE');

      const verified = await http(app)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: challenge.body.challengeToken, code: totpCode(setup.body.secret), client: 'mobile' })
        .expect(200);
      expect(verified.body.status).toBe('authenticated');

      const recovery = { challengeToken: challenge.body.challengeToken, code: enabled.body.recoveryCodes[0], client: 'mobile' };
      await http(app).post(`${API}/auth/mfa/verify`).send(recovery).expect(200);
      await http(app).post(`${API}/auth/mfa/verify`).send(recovery).expect(401);
      await unlock();

      await http(app)
        .post(`${API}/account/mfa/disable`)
        .set(...bearer(verified.body.accessToken))
        .send({ password: PASSWORD })
        .expect(204);
      await login(app, email);
    });
  });
});
