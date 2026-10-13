import type { MfaEnabledResponse, MfaSetupResponse, SessionSummary } from '@brisas/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext, RequestMeta } from '../common/request-context';
import { ChangePasswordDto, MfaDisableDto, MfaEnableDto } from './auth.dto';
import { AuthService } from './auth.service';
import { Auth, Meta } from './decorators';

@ApiTags('Mi cuenta')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Dispositivos con sesión abierta' })
  sessions(@Auth() auth: AuthContext): Promise<SessionSummary[]> {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cerrar la sesión de un dispositivo' })
  async revokeSession(@Auth() auth: AuthContext, @Param('sessionId', ParseUUIDPipe) sessionId: string): Promise<void> {
    await this.auth.revokeSession(auth, sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cerrar todas las sesiones excepto la actual' })
  revokeOthers(@Auth() auth: AuthContext): Promise<{ revoked: number }> {
    return this.auth.revokeOtherSessions(auth);
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cambiar la contraseña', description: 'Cierra las demás sesiones abiertas.' })
  async changePassword(@Auth() auth: AuthContext, @Body() body: ChangePasswordDto, @Meta() meta: RequestMeta) {
    await this.auth.changePassword(auth, body, meta);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generar el secreto y el código QR de la verificación en dos pasos' })
  setupMfa(@Auth() auth: AuthContext): Promise<MfaSetupResponse> {
    return this.auth.setupMfa(auth);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activar la verificación en dos pasos y obtener los códigos de recuperación' })
  enableMfa(@Auth() auth: AuthContext, @Body() body: MfaEnableDto, @Meta() meta: RequestMeta): Promise<MfaEnabledResponse> {
    return this.auth.enableMfa(auth, body.code, meta);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desactivar la verificación en dos pasos (exige la contraseña)' })
  async disableMfa(@Auth() auth: AuthContext, @Body() body: MfaDisableDto, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.disableMfa(auth, body.password, meta);
  }
}
