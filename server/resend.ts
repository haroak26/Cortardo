import { Resend } from "resend";

const SENDER_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@cortardo.com";
const SENDER_NAME = process.env.RESEND_FROM_NAME || "Cortardo";
const MAX_RETRIES = 3;

let client: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new Resend(apiKey);
  }
  return client;
}

interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  from?: { email: string; name?: string };
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendViaResend(params: SendEmailParams): Promise<boolean> {
  const c = getClient();
  if (!c) return false;

  if (!validateEmail(params.to)) {
    console.warn("[resend] Invalid recipient email:", params.to);
    return false;
  }
  if (!params.subject) {
    console.warn("[resend] Empty subject, skipping");
    return false;
  }

  const fromEmail = params.from?.email || SENDER_EMAIL;
  const fromName = params.from?.name || SENDER_NAME;
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** attempt, 10_000);
      console.warn(`[resend] Retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms`);
      await sleep(backoff);
    }

    try {
      const { error } = await c.emails.send({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.htmlContent,
        text: params.textContent,
      });
      if (error) {
        lastError = error;
        console.warn(`[resend] Attempt ${attempt + 1}/${MAX_RETRIES} failed (from: ${from}, to: ${params.to}):`, error.message);
        continue;
      }
      return true;
    } catch (err) {
      lastError = err;
      console.warn(`[resend] Attempt ${attempt + 1}/${MAX_RETRIES} failed (from: ${from}, to: ${params.to}):`, err);
    }
  }

  console.warn("[resend] All retries exhausted, giving up:", lastError);
  return false;
}