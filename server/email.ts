import { randomInt } from "crypto";
import {
  buildEmailChangeTemplate,
  buildPasswordResetTemplate,
  buildTwoFactorTemplate,
  buildVerificationTemplate,
  buildPinTemplate,
  buildNewDeviceTemplate,
  buildWelcomeTemplate,
  buildWorkspaceInviteTemplate,
  buildMemberAcceptedInviteTemplate,
  buildMemberDeclinedInviteTemplate,
  buildMemberLeftWorkspaceTemplate,
  buildMemberRemovedTemplate,
  buildSubscriptionUpdateTemplate,
  buildAccountDeletionTemplate,
  renderMarkdown,
  stripHtml,
  CORTARDO_EMAIL_STYLES,
} from "./emailTemplates";
import { sendMailFromSmtp } from "./transport-pool";
import { sendViaBrevo } from "./brevo";
import { sendViaResend } from "./resend";

export { stripHtml, renderMarkdown } from "./emailTemplates";

function sanitizeName(name: string): string {
  return name.replace(/[\r\n"]/g, "");
}

// ─── Auth / Transactional Emails ───────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const code = randomInt(100000, 999999).toString();
  const { html, text } = buildVerificationTemplate(code);
  await sendSecureMail(to, "Verify your Cortardo email address", text, html);
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const link = `${baseUrl}/auth/reset-password?token=${token}`;
  const { html, text } = buildPasswordResetTemplate(link);
  await sendSecureMail(to, "Reset your Cortardo password", text, html);
}

export async function sendEmailChangeVerification(
  to: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const link = `${baseUrl}/api/me/verify-email-change?token=${token}`;
  const { html, text } = buildEmailChangeTemplate(link);
  await sendSecureMail(to, "Confirm your new Cortardo email address", text, html);
}

// ─── Helpers ───────────────────────────────────────────────────────

function getSecureFrom(): { name: string; email: string } {
  const defaultName = process.env.RESEND_FROM_NAME || process.env.BREVO_SENDER_NAME || "Cortardo";
  // SECURE_EMAIL / SMTP_FROM may be either "Name <email>" or a bare email.
  const raw = process.env.SECURE_EMAIL || process.env.SMTP_FROM;
  if (raw) {
    const match = raw.match(/^(?:"?([^"]*)"?\s+)?<(.+)>$/);
    if (match) return { name: match[1] || defaultName, email: match[2] };
    if (raw.includes("@")) return { name: defaultName, email: raw };
    return { name: defaultName, email: raw };
  }
  return { name: defaultName, email: "secure@cortardo.com" };
}

/** Fallback SMTP config — honors the generic SMTP env vars (SMTP_HOST/PORT/USER/PASS).
 *  Defaults to localhost:25 with no auth, matching the original behavior. */
function getSmtpFallbackConfig() {
  return {
    host: process.env.SMTP_HOST || "localhost",
    port: Number(process.env.SMTP_PORT) || 25,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  };
}

function inboxFrom(_inbox: { name?: string | null; emailAddress?: string | null }): string {
  return "";
}

async function sendSecureMail(to: string, subject: string, textContent: string, htmlContent: string): Promise<boolean> {
  const ok = await sendTransactionalMail({ to, subject, textContent, htmlContent });
  if (ok) return true;
  try {
    const from = getSecureFrom();
    const fromField = `${from.name} <${from.email}>`;
    await sendMailFromSmtp(getSmtpFallbackConfig(), { from: fromField, to, subject, text: textContent, html: htmlContent });
    return true;
  } catch (fallbackErr) {
    console.warn("[email] SMTP fallback send failed:", fallbackErr);
    return false;
  }
}

interface TransactionalMailParams {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

async function sendTransactionalMail(params: TransactionalMailParams): Promise<boolean> {
  if (await sendViaResend(params)) return true;
  if (await sendViaBrevo(params)) return true;
  console.warn("[email] No Resend or Brevo configured — email not sent:", params.subject);
  return false;
}

function getInviteSender(): { email: string; name?: string } {
  return {
    email: process.env.RESEND_INVITE_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@cortardo.com",
    name: process.env.RESEND_INVITE_NAME || process.env.RESEND_FROM_NAME || "Cortardo",
  };
}

/** Team-management emails (invites, accept/decline/left/removed) — sent via the
 *  dedicated invite sender (RESEND_INVITE_EMAIL / RESEND_INVITE_NAME) when configured. */
async function sendTeamMail(params: TransactionalMailParams): Promise<boolean> {
  if (await sendViaResend({ ...params, from: getInviteSender() })) return true;
  if (await sendViaBrevo(params)) return true;
  console.warn("[email] Team email not sent (Resend + Brevo failed):", params.subject, "→", params.to);
  return false;
}

export async function sendTwoFactorEmail(
  to: string,
  code: string,
  challengeId: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const link = `${baseUrl}/api/login/verify-link?challengeId=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(token)}`;
  const { html, text } = buildTwoFactorTemplate(link, code);
  await sendSecureMail(to, "Your Cortardo verification code", text, html);
}

export async function sendAdminTwoFactorEmail(
  to: string,
  code: string,
  challengeId: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const link = `${baseUrl}/api/admin/login/2fa/verify-link?challengeId=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(token)}`;
  const { html, text } = buildTwoFactorTemplate(link, code);
  await sendSecureMail(to, "Your admin verification code", text, html);
}

export async function sendPinEmail(
  to: string,
  pin: string,
): Promise<void> {
  const { html, text } = buildPinTemplate(pin);
  await sendTransactionalMail({
    to,
    subject: "Your Cortardo verification code",
    htmlContent: html,
    textContent: text,
  });
}

export async function sendWelcomeEmail(
  to: string,
  name: string,
  details?: { workspaceName?: string },
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildWelcomeTemplate(name, details);
  await sendTransactionalMail({
    to,
    toName: name,
    subject: "Welcome to Cortardo!",
    htmlContent,
    textContent,
  });
}

export function appendTicketFooter(body: string, _ticketId?: string, _trackingUrl?: string): string {
  return body;
}

export async function sendWorkspaceInviteEmail(
  to: string,
  invitedByName: string,
  workspaceName: string,
  inviteUrl: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildWorkspaceInviteTemplate(invitedByName, workspaceName, inviteUrl);
  await sendTeamMail({ to, subject: `You've been invited to ${workspaceName}`, textContent, htmlContent });
}

export async function sendMemberAcceptedInviteEmail(
  to: string,
  recipientName: string | undefined,
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  role: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildMemberAcceptedInviteTemplate(workspaceName, memberName, memberEmail, role);
  await sendTeamMail({
    to,
    toName: recipientName,
    subject: `${memberName} joined ${workspaceName}`,
    htmlContent,
    textContent,
  });
}

export async function sendMemberDeclinedInviteEmail(
  to: string,
  recipientName: string | undefined,
  workspaceName: string,
  memberName: string,
  memberEmail: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildMemberDeclinedInviteTemplate(workspaceName, memberName, memberEmail);
  await sendTeamMail({
    to,
    toName: recipientName,
    subject: `${memberName} declined the invitation to ${workspaceName}`,
    htmlContent,
    textContent,
  });
}

export async function sendMemberLeftWorkspaceEmail(
  to: string,
  recipientName: string | undefined,
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  role: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildMemberLeftWorkspaceTemplate(workspaceName, memberName, memberEmail, role);
  await sendTeamMail({
    to,
    toName: recipientName,
    subject: `${memberName} left ${workspaceName}`,
    htmlContent,
    textContent,
  });
}

export async function sendMemberRemovedEmail(
  to: string,
  recipientName: string | undefined,
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  removedBy: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildMemberRemovedTemplate(workspaceName, memberName, memberEmail, removedBy);
  await sendTeamMail({
    to,
    toName: recipientName,
    subject: `${memberName} was removed from ${workspaceName}`,
    htmlContent,
    textContent,
  });
}

export async function sendTicketAssignedEmail(
  to: string,
  assigneeName: string,
  ticketSubject: string,
  ticketId: string,
  assignedByName: string,
  publicId?: number | null,
): Promise<void> {
  const displayId = publicId != null ? `#${publicId}` : `#${ticketId}`;
  const textContent = `You've been assigned a ticket on Cortardo

Hi ${assigneeName},

${assignedByName} has assigned you to ticket ${displayId}: "${ticketSubject}".

Click the link below to view and respond to the ticket:
https://app.cortardo.com/home/tickets/detail/${ticketId}

— The Cortardo team`;

  const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CORTARDO_EMAIL_STYLES}</style>
</head>
<body>
<h1>Ticket assigned to you</h1>
<p>Hi ${assigneeName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}, you've been assigned a new ticket.</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.8">
  <strong style="color:#6b7280">Ticket:</strong> ${String(displayId).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}<br>
  <strong style="color:#6b7280">Subject:</strong> ${ticketSubject.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
</p>
<p>${assignedByName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")} has assigned this ticket to you.</p>
<p><a href="https://app.cortardo.com/home/tickets/detail/${ticketId}" style="color:#4682B4;font-weight:500">View ticket →</a></p>
</body>
</html>`;

  await sendSecureMail(to, `Assigned to ticket #${ticketId}: ${ticketSubject}`, textContent, htmlContent);
}

export async function sendNewDeviceEmail(
  to: string,
  userName: string,
  deviceInfo: { browser?: string; os?: string; ip?: string; location?: string; time?: string },
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildNewDeviceTemplate(userName, to, deviceInfo);
  await sendSecureMail(to, "New sign-in to your Cortardo account", textContent, htmlContent);
}

export async function sendSubscriptionUpdateEmail(
  to: string,
  name: string,
  planName: string,
  action: "new" | "cancelled" | "updated",
  billingDate?: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildSubscriptionUpdateTemplate(name, planName, action, billingDate);
  const subjects: Record<string, string> = {
    new: `You're now on the ${planName} plan`,
    cancelled: "Your Cortardo subscription has been cancelled",
    updated: `Your Cortardo plan has been updated to ${planName}`,
  };
  await sendTransactionalMail({
    to,
    toName: name,
    subject: subjects[action],
    htmlContent,
    textContent,
  });
}

export async function sendAccountDeletionEmail(
  to: string,
  name: string,
): Promise<void> {
  const { html: htmlContent, text: textContent } = buildAccountDeletionTemplate(name, to);
  await sendTransactionalMail({
    to,
    toName: name,
    subject: "Your Cortardo account has been deleted",
    htmlContent,
    textContent,
  });
}

/** Send a set of test emails to verify all template redesigns. */
export async function sendAllTestEmails(to: string, baseUrl: string): Promise<void> {
  // 1. Verification / PIN email
  const verify = buildVerificationTemplate("482916");
  await sendSecureMail(to, "TEST: Verify your Cortardo email address", verify.text, verify.html);
  console.log("  ✓ Verification email sent");

  // 2. Password reset email
  const resetLink = `${baseUrl}/auth/reset-password?token=test-reset-token-123`;
  const reset = buildPasswordResetTemplate(resetLink);
  await sendSecureMail(to, "TEST: Reset your Cortardo password", reset.text, reset.html);
  console.log("  ✓ Password reset email sent");

  // 3. Workspace invite email
  await sendWorkspaceInviteEmail(to, "Alice", "Acme Corp", `${baseUrl}/invite/test-123`);
  console.log("  ✓ Workspace invite email sent");

  // 4. New device / sign-in email
  await sendNewDeviceEmail(to, "Rach", {
    browser: "Chrome 135",
    os: "macOS 15",
    ip: "203.0.113.42",
    location: "Sydney, Australia",
    time: "Monday, June 15, 2026 at 10:00 AM UTC",
  });
  console.log("  ✓ New device / sign-in email sent");

  // 5. Welcome email
  await sendWelcomeEmail(to, "Rach", {
    workspaceName: "Acme Corp",
  });
  console.log("  ✓ Welcome email sent");

  // 6. Ticket assigned email
  await sendTicketAssignedEmail(to, "Rach", "Login issue with dashboard", "TKT-4242", "Alice");
  console.log("  ✓ Ticket assigned email sent");

  // 7. Subscription update — new subscription
  await sendSubscriptionUpdateEmail(to, "Rach", "Pro", "new", "July 15, 2026");
  console.log("  ✓ Subscription new email sent");

  // 8. Subscription update — cancelled
  await sendSubscriptionUpdateEmail(to, "Rach", "Pro", "cancelled", "July 15, 2026");
  console.log("  ✓ Subscription cancelled email sent");

  // 9. Account deletion
  await sendAccountDeletionEmail(to, "Rach");
  console.log("  ✓ Account deletion email sent");

  // 10. Member accepted invite (admin notification)
  await sendMemberAcceptedInviteEmail(to, "Alice", "Acme Corp", "Rach", "rach@acme.com", "editor");
  console.log("  ✓ Member accepted invite email sent");

  // 11. Member declined invite (admin notification)
  await sendMemberDeclinedInviteEmail(to, "Alice", "Acme Corp", "Rach", "rach@acme.com");
  console.log("  ✓ Member declined invite email sent");

  // 12. Member left workspace (admin notification)
  await sendMemberLeftWorkspaceEmail(to, "Alice", "Acme Corp", "Rach", "rach@acme.com", "editor");
  console.log("  ✓ Member left workspace email sent");

  // 13. Member removed (admin notification)
  await sendMemberRemovedEmail(to, "Alice", "Acme Corp", "Rach", "rach@acme.com", "Bob");
  console.log("  ✓ Member removed email sent");
}
