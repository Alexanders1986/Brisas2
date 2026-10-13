import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaLoginSchema,
  refreshSchema,
  resetPasswordSchema,
} from '@brisas/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class LoginDto extends createZodDto(loginSchema) {}
export class MfaLoginDto extends createZodDto(mfaLoginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}
export class InvitationPreviewDto extends createZodDto(z.object({ token: z.string().min(20).max(200) })) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class MfaEnableDto extends createZodDto(mfaEnableSchema) {}
export class MfaDisableDto extends createZodDto(mfaDisableSchema) {}
