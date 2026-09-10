import { BrevoClient } from "@getbrevo/brevo";

const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@cortardo.com";
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "Cortardo";
const MAX_RETRIES = 3;

let client: BrevoClient | null = null;

function getClient(): BrevoClient | null {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new BrevoClient({ apiKey });
  }
  return client;
}

interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendViaBrevo(params: SendEmailParams): Promise<boolean> {
  const c = getClient();
  if (!c) return false;

  if (!validateEmail(params.to)) {
    console.warn("[brevo] Invalid recipient email:", params.to);
    return false;
  }
  if (!params.subject) {
    console.warn("[brevo] Empty subject, skipping");
    return false;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** attempt, 10_000);
      console.warn(`[brevo] Retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms`);
      await sleep(backoff);
    }

    try {
      await c.transactionalEmails.sendTransacEmail({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: params.to, name: params.toName }],
        subject: params.subject,
        htmlContent: params.htmlContent,
        textContent: params.textContent,
      });
      return true;
    } catch (err) {
      lastError = err;
      console.warn(`[brevo] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, err);
    }
  }

  console.warn("[brevo] All retries exhausted, giving up:", lastError);
  return false;
}
