import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Se reenvía al proveedor para que un reintento no produzca un segundo correo. */
  idempotencyKey: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<{ providerMessageId?: string }>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Desarrollo: no envía nada; muestra el correo y sus enlaces en la consola. */
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Correo');

  async send(message: MailMessage) {
    const links = [...message.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    this.logger.log(`Para: ${message.to} · Asunto: ${message.subject}${links.length ? ` · Enlace: ${links[0]}` : ''}`);
    return {};
  }
}

/** Pruebas automatizadas: guarda los correos para poder inspeccionarlos. */
export class MemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage) {
    this.sent.push(message);
    return { providerMessageId: `memory-${this.sent.length}` };
  }
}

export class ResendMailTransport implements MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Resend respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as { id?: string };
    return { providerMessageId: body.id };
  }
}

export function createMailTransport(config: AppConfig): MailTransport {
  if (config.mailTransport === 'resend') {
    if (!config.resendApiKey) throw new Error('MAIL_TRANSPORT=resend requiere RESEND_API_KEY.');
    return new ResendMailTransport(config.resendApiKey, config.mailFrom);
  }
  return config.mailTransport === 'memory' ? new MemoryMailTransport() : new LogMailTransport();
}
