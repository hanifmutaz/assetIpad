import nodemailer from 'nodemailer';
import { cfg } from './config.js';
import { logger } from './logger.js';

const transport = cfg.smtpReady
  ? nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_SECURE === 'true',
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    logger.warn({ to, subject }, 'SMTP belum diatur – email tidak dikirim');
    return;
  }
  await transport.sendMail({ from: cfg.MAIL_FROM, to, subject, text });
}
