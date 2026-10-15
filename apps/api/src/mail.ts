import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from './config';
import { MailDeliveryError, sendBrevoEmail, verifyBrevo } from './mail-delivery';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly transporter = config.smtp ? nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.auth, requireTLS: config.production && !config.smtp.secure,
    connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  }) : undefined;
  async onModuleInit() {
    if (!config.production) return;
    if (config.brevo) await verifyBrevo(config.brevo);
    if (this.transporter) {
      try { await this.transporter.verify(); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const hint = code === 'EAUTH' ? 'Check SMTP_USER and SMTP_PASSWORD.'
          : code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET'
            ? 'Check SMTP network access. Render Free blocks ports 25, 465 and 587; use MAIL_MODE=brevo there.'
            : 'Check SMTP host, port, TLS and credentials.';
        throw new MailDeliveryError(`SMTP startup check failed. ${hint}`);
      }
    }
  }
  async sendLink(email: string, purpose: 'verify' | 'reset', token: string) {
    const route = purpose === 'verify' ? 'verify-email' : 'reset-password';
    const subject = purpose === 'verify' ? 'Verify your MyCampusToCareer email' : 'Reset your MyCampusToCareer password';
    const lifetime = purpose === 'verify' ? '24 hours' : '30 minutes';
    const link = `${config.appOrigin}/${route}?token=${token}`;
    const text = `${subject}\n\nOpen this link: ${link}\n\nThis link expires in ${lifetime} and can be used once. If you did not request this, ignore this message.\n`;
    if (config.emailMode === 'file') {
      await mkdir(config.mailOutboxDir, { recursive: true });
      await writeFile(join(config.mailOutboxDir, `${Date.now()}-${randomUUID()}.eml`),
        `To: ${email}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${text}`, { mode: 0o600 });
      return;
    }
    if (config.brevo) {
      await sendBrevoEmail(config.brevo, { email, subject, text });
      return;
    }
    await this.transporter!.sendMail({ from: config.smtp!.from, to: email, subject, text });
  }
}
