import { z } from 'zod';
import { emailSchema } from './common';
import type { PermissionKey, RoleKey } from './permissions';

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(128, 'La contraseña es demasiado larga')
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    error: 'Incluye al menos una letra y un número',
  });

const clientTypeSchema = z.enum(['web', 'mobile']).default('web');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Escribe tu contraseña').max(128),
  /** web: el refresh token viaja en cookie httpOnly. mobile: viaja en el cuerpo. */
  client: clientTypeSchema,
});
export type LoginInput = z.input<typeof loginSchema>;

/** Código TOTP de 6 dígitos o código de recuperación (XXXXX-XXXXX). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, 'Escribe el código de 6 dígitos o un código de recuperación');

export const mfaLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: mfaCodeSchema,
  client: clientTypeSchema,
});
export type MfaLoginInput = z.input<typeof mfaLoginSchema>;

export const refreshSchema = z.object({
  /** Solo clientes móviles; en web se lee de la cookie. */
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'El enlace no es válido'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20, 'El enlace no es válido'),
  password: passwordSchema,
  acceptPrivacyPolicy: z.literal(true, {
    error: 'Debes aceptar la política de tratamiento de datos para continuar',
  }),
});
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Escribe tu contraseña actual').max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const mfaEnableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Escribe el código de 6 dígitos'),
});
export const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Escribe tu contraseña').max(128),
});

/** Versión vigente de la política de tratamiento de datos que acepta el usuario. */
export const PRIVACY_POLICY_VERSION = '2026-01';

// ---------------------------------------------------------------- respuestas

export interface MembershipSummary {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended';
  primaryColor: string | null;
  roles: RoleKey[];
  permissions: PermissionKey[];
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
  /** true cuando la política exige MFA y el usuario aún no lo ha activado. */
  mfaEnrollmentRequired: boolean;
  memberships: MembershipSummary[];
}

export interface AuthTokensResponse {
  accessToken: string;
  /** Segundos de vida del access token. */
  expiresIn: number;
  /** Solo se incluye para clientes móviles. */
  refreshToken?: string;
}

export type LoginResponse =
  | ({ status: 'authenticated' } & AuthTokensResponse)
  | { status: 'mfa_required'; challengeToken: string };

export interface SessionSummary {
  id: string;
  current: boolean;
  client: 'web' | 'mobile';
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface MfaEnabledResponse {
  recoveryCodes: string[];
}

export interface InvitationPreview {
  email: string;
  tenantName: string | null;
}
