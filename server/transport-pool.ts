import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { decrypt } from "./encryption";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

const SMTP_CONNECT_TIMEOUT_MS = 30_000;
const SMTP_GREETING_TIMEOUT_MS = 15_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

const pool = new Map<string, { transport: Transporter; expires: number }>();
const POOL_TTL = 5 * 60 * 1000;

function configKey(config: SmtpConfig): string {
  return `${config.host}:${config.port}:${config.auth.user}`;
}

function getTransport(config: SmtpConfig): Transporter {
  const key = configKey(config);
  const existing = pool.get(key);
  if (existing && Date.now() < existing.expires) {
    return existing.transport;
  }
  if (existing) {
    try { existing.transport.close(); } catch {}
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
  pool.set(key, { transport, expires: Date.now() + POOL_TTL });
  return transport;
}

export function closeTransport(config: SmtpConfig): void {
  const key = configKey(config);
  const existing = pool.get(key);
  if (existing) {
    try { existing.transport.close(); } catch {}
    pool.delete(key);
  }
}

export function closeAllTransports(): void {
  for (const [, entry] of pool) {
    try { entry.transport.close(); } catch {}
  }
  pool.clear();
}

export function createInboxTransport(inbox: {
  smtpHost?: string | null;
  smtpPort?: number | null;
  username?: string | null;
  password?: string | null;
}): Transporter {
  return getTransport({
    host: inbox.smtpHost!,
    port: inbox.smtpPort!,
    secure: inbox.smtpPort !== 587,
    auth: { user: inbox.username!, pass: decrypt(inbox.password!) },
  });
}

export function createSmtpTransport(config: {
  host: string;
  port: number;
  user: string;
  pass: string;
}): Transporter {
  return getTransport({
    host: config.host,
    port: config.port,
    secure: config.port !== 587,
    auth: { user: config.user, pass: config.pass },
  });
}

const SMTP_SEND_TIMEOUT_MS = 30_000;

export async function sendMailWithTimeout(transporter: Transporter, mailOptions: nodemailer.SendMailOptions): Promise<void> {
  await Promise.race([
    transporter.sendMail(mailOptions),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`SMTP sendMail timed out after ${SMTP_SEND_TIMEOUT_MS}ms`)), SMTP_SEND_TIMEOUT_MS)
    ),
  ]);
}

export async function sendMailFromInbox(
  inbox: {
    smtpHost?: string | null;
    smtpPort?: number | null;
    username?: string | null;
    password?: string | null;
  },
  mailOptions: nodemailer.SendMailOptions,
): Promise<void> {
  const config: SmtpConfig = {
    host: inbox.smtpHost!,
    port: inbox.smtpPort!,
    secure: inbox.smtpPort !== 587,
    auth: { user: inbox.username!, pass: decrypt(inbox.password!) },
  };
  const transporter = getTransport(config);
  try {
    await sendMailWithTimeout(transporter, mailOptions);
  } catch (err) {
    closeTransport(config);
    throw err;
  }
}

export async function sendMailFromSmtp(
  config: { host: string; port: number; user: string; pass: string },
  mailOptions: nodemailer.SendMailOptions,
): Promise<void> {
  const smtpConfig: SmtpConfig = {
    host: config.host,
    port: config.port,
    secure: config.port !== 587,
    auth: { user: config.user, pass: config.pass },
  };
  const transporter = getTransport(smtpConfig);
  try {
    await sendMailWithTimeout(transporter, mailOptions);
  } catch (err) {
    closeTransport(smtpConfig);
    throw err;
  }
}
