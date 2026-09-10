const GREETINGS = ["Hi", "Hello", "Hey", "Greetings"];

const WEEKDAY_GREETINGS: Record<number, string[]> = {
  0: ["Happy Sunday", "Good Sunday morning"],
  1: ["Happy Monday", "Good Monday morning", "Hope your week is off to a great start"],
  2: ["Happy Tuesday", "Good Tuesday morning"],
  3: ["Happy Wednesday", "Good Wednesday morning", "Halfway through the week"],
  4: ["Happy Thursday", "Good Thursday morning"],
  5: ["Happy Friday", "Good Friday morning", "Great way to end the week"],
  6: ["Happy Saturday", "Good Saturday"],
};

export interface TemplateContext {
  ticketId?: string;
  ticketSubject?: string;
  userFirstName?: string;
  userFullName?: string;
  userEmail?: string;
  agentName?: string;
  inboxName?: string;
  siteName?: string;
  agentReply?: string;
}

export function resolveTemplate(
  template: string,
  ctx: TemplateContext,
): string {
  const now = new Date();
  const dayOfWeek = now.getDay();

  return template
    .replace(/\{TICKET_ID\}/g, ctx.ticketId ?? "")
    .replace(/\{TICKET_SUBJECT\}/g, ctx.ticketSubject ?? "")
    .replace(/\{USER_FIRST_NAME\}/g, ctx.userFirstName ?? "")
    .replace(/\{USER_FULL_NAME\}/g, ctx.userFullName ?? ctx.userFirstName ?? "")
    .replace(/\{USER_EMAIL\}/g, ctx.userEmail ?? "")
    .replace(/\{AGENT_NAME\}/g, ctx.agentName ?? "Agent")
    .replace(/\{INBOX_NAME\}/g, ctx.inboxName ?? "")
    .replace(/\{AGENT_REPLY\}/g, ctx.agentReply ?? "")
    .replace(/\{SITE_NAME\}/g, ctx.siteName ?? "Cortardo")
    .replace(/\{GREETING\}/g, () => {
      const dayGreetings = WEEKDAY_GREETINGS[dayOfWeek];
      const pool = dayGreetings ?? GREETINGS;
      return pool[Math.floor(Math.random() * pool.length)];
    })
    .replace(/\{CURRENT_DATE\}/g, now.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }))
    .replace(/\{CURRENT_YEAR\}/g, String(now.getFullYear()));
}

export async function renderUserTemplate(
  _storage: unknown,
  _userId: string,
  _type: string,
  ctx: TemplateContext,
  defaults: { subject: string; body: string },
): Promise<{ subject: string; body: string }> {
  return {
    subject: resolveTemplate(defaults.subject, ctx),
    body: resolveTemplate(defaults.body, ctx),
  };
}
