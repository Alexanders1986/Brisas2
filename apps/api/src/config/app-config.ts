import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'DATA_ENCRYPTION_KEY debe ser 32 bytes en base64'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  MFA_REQUIRED_FOR_ADMINS: booleanFromEnv,
  MAIL_TRANSPORT: z.enum(['log', 'resend', 'memory']).default('log'),
  MAIL_FROM: z.string().default('Brisas <no-responder@example.com>'),
  RESEND_API_KEY: z.string().optional(),
  /** Número de proxies de confianza delante de la API (Next.js, balanceador). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Desactiva el trabajador de correos (las pruebas lo ejecutan manualmente). */
  MAIL_WORKER_DISABLED: booleanFromEnv,
  /** Multiplica los límites de peticiones; las pruebas lo suben para no chocar con ellos. */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(1000).default(1),
});

const DEV_SECRET_MARKERS = ['cambia-este-secreto', 'ZGVzYXJyb2xsby1sb2NhbC1jbGF2ZS0zMi1ieXRlcyE='];

export class AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly port: number;
  readonly webUrl: string;
  readonly databaseUrl: string;
  readonly jwtAccessSecret: string;
  readonly dataEncryptionKey: Buffer;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly mfaRequiredForAdmins: boolean;
  readonly mailTransport: 'log' | 'resend' | 'memory';
  readonly mailFrom: string;
  readonly resendApiKey?: string;
  readonly trustProxyHops: number;
  readonly mailWorkerDisabled: boolean;
  readonly rateLimitMultiplier: number;

  constructor(source: NodeJS.ProcessEnv) {
    const parsed = envSchema.safeParse(source);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
      throw new Error(`Configuración inválida. Revisa las variables de entorno:\n${problems}`);
    }
    const env = parsed.data;
    if (env.NODE_ENV === 'production') {
      const usesDevSecret = [env.JWT_ACCESS_SECRET, env.DATA_ENCRYPTION_KEY].some((secret) =>
        DEV_SECRET_MARKERS.some((marker) => secret.includes(marker)),
      );
      if (usesDevSecret) throw new Error('No se puede iniciar en producción con los secretos de ejemplo de .env.example.');
      if (env.MAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY.');
      if (!env.WEB_URL.startsWith('https://')) throw new Error('WEB_URL debe usar HTTPS en producción.');
    }
    this.env = env.NODE_ENV;
    this.port = env.API_PORT;
    this.webUrl = env.WEB_URL.replace(/\/$/, '');
    this.databaseUrl = env.DATABASE_URL;
    this.jwtAccessSecret = env.JWT_ACCESS_SECRET;
    this.dataEncryptionKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    this.accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
    this.refreshTokenTtlDays = env.REFRESH_TOKEN_TTL_DAYS;
    this.mfaRequiredForAdmins = env.MFA_REQUIRED_FOR_ADMINS;
    this.mailTransport = env.MAIL_TRANSPORT;
    this.mailFrom = env.MAIL_FROM;
    this.resendApiKey = env.RESEND_API_KEY;
    this.trustProxyHops = env.TRUST_PROXY_HOPS;
    this.mailWorkerDisabled = env.MAIL_WORKER_DISABLED;
    this.rateLimitMultiplier = env.RATE_LIMIT_MULTIPLIER;
  }

  get isProduction(): boolean {
    return this.env === 'production';
  }
}

/** Carga el .env de la raíz del monorepo (sin pisar el entorno real) y valida la configuración. */
export function loadAppConfig(): AppConfig {
  loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env'), quiet: true });
  return new AppConfig(process.env);
}
