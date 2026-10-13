import type { AuthTokensResponse, InvitationPreview, LoginResponse, MeResponse } from '@brisas/contracts';
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AppError } from '../common/errors';
import type { AuthContext, RequestMeta } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import {
  AcceptInvitationDto,
  ForgotPasswordDto,
  InvitationPreviewDto,
  LoginDto,
  MfaLoginDto,
  RefreshDto,
  ResetPasswordDto,
} from './auth.dto';
import { AuthService, type IssuedSession } from './auth.service';
import { Auth, Meta, Public } from './decorators';

export const REFRESH_COOKIE = 'brisas_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const CLIENT_HEADER = 'x-brisas-client';

/** Límite estricto por IP para rutas sensibles (se relaja en pruebas con RATE_LIMIT_MULTIPLIER). */
const strict = (perMinute: number) => ({
  default: { ttl: 60_000, limit: () => perMinute * Number(process.env.RATE_LIMIT_MULTIPLIER ?? 1) },
});

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(strict(10))
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Con `client: "web"` el refresh token se entrega en una cookie httpOnly; con `client: "mobile"` va en el cuerpo. ' +
      'Si la cuenta tiene verificación en dos pasos responde `mfa_required` con un `challengeToken`.',
  })
  @ApiResponse({ status: 200, description: 'Sesión iniciada o verificación en dos pasos requerida' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 429, description: 'ACCOUNT_LOCKED o RATE_LIMITED' })
  async login(
    @Body() body: LoginDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const outcome = await this.auth.login(body, meta);
    if (outcome.status === 'mfa_required') return outcome;
    return { status: 'authenticated', ...this.deliver(outcome.session, body.client, response) };
  }

  @Public()
  @Throttle(strict(10))
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Completar el inicio de sesión con el código de verificación en dos pasos' })
  async verifyMfa(
    @Body() body: MfaLoginDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const session = await this.auth.verifyMfaLogin(body, meta);
    return { status: 'authenticated', ...this.deliver(session, body.client, response) };
  }

  @Public()
  @Throttle(strict(60))
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renovar el access token',
    description:
      'Rota el refresh token. En web se lee de la cookie y exige el encabezado `X-Brisas-Client: web`; ' +
      'en móvil se envía en el cuerpo.',
  })
  async refresh(
    @Body() body: RefreshDto,
    @Req() request: Request,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokensResponse> {
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const client = body.refreshToken ? 'mobile' : 'web';
    if (client === 'web') this.assertWebClient(request);
    const refreshToken = body.refreshToken ?? cookieToken;
    if (!refreshToken) throw AppError.unauthorized();
    try {
      return this.deliver(await this.auth.refresh(refreshToken, meta), client, response);
    } catch (error) {
      if (client === 'web' && error instanceof AppError && error.getStatus() === 401) this.clearCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar la sesión actual' })
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(auth);
    this.clearCookie(response);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usuario autenticado, sus conjuntos, roles y permisos' })
  me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return this.auth.me(auth);
  }

  @Public()
  @Throttle(strict(5))
  @Post('password/forgot')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Solicitar el enlace para restablecer la contraseña',
    description: 'Responde 202 exista o no la cuenta, para no revelar qué correos están registrados.',
  })
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Throttle(strict(10))
  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Crear una nueva contraseña con el enlace recibido por correo' })
  async resetPassword(@Body() body: ResetPasswordDto, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.resetPassword(body, meta);
  }

  @Public()
  @Throttle(strict(20))
  @Post('invitations/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validar un enlace de invitación antes de mostrar el formulario' })
  previewInvitation(@Body() body: InvitationPreviewDto): Promise<InvitationPreview> {
    return this.auth.previewInvitation(body.token);
  }

  @Public()
  @Throttle(strict(10))
  @Post('invitations/accept')
  @HttpCode(204)
  @ApiOperation({ summary: 'Activar la cuenta: crear contraseña y aceptar el tratamiento de datos' })
  async acceptInvitation(@Body() body: AcceptInvitationDto, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.acceptInvitation(body, meta);
  }

  // ---------------------------------------------------------------- internos

  private deliver(session: IssuedSession, client: 'web' | 'mobile', response: Response): AuthTokensResponse {
    const tokens: AuthTokensResponse = { accessToken: session.accessToken, expiresIn: session.expiresIn };
    if (client === 'mobile') return { ...tokens, refreshToken: session.refreshToken };
    response.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.cookieOptions(), expires: session.refreshExpiresAt });
    return tokens;
  }

  private clearCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    // httpOnly: JavaScript no puede leerla (mitiga XSS). SameSite=Strict: no viaja en
    // peticiones iniciadas desde otros sitios (mitiga CSRF). Path: solo llega a /auth.
    return { httpOnly: true, secure: this.config.isProduction, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
  }

  /** Segunda defensa CSRF: un formulario de otro sitio no puede añadir encabezados propios. */
  private assertWebClient(request: Request): void {
    if (request.get(CLIENT_HEADER) !== 'web') throw AppError.forbidden('CSRF_CHECK_FAILED', 'Solicitud no permitida.');
  }
}
