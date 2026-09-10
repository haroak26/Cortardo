import { marked } from "marked";

export type ActionEmailTemplate = {
  html: string;
  text: string;
};

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Brand Logo SVG (inline, for email use) ────────────────────
const CORTARDO_LOGO_PATH =
  "M 957.500 974.048 C 889.538 978.782, 827.135 1016.953, 790.371 1076.280 C 772.757 1104.703, 759.949 1145.131, 759.607 1173.387 L 759.500 1182.273 1189.330 1325.527 L 1619.000 1468.781 2048.670 1325.527 L 2478.500 1182.273 C 2478.051 1145.131, 2465.243 1104.703, 2447.629 1076.280 C 2410.865 1016.953, 2348.462 978.782, 2280.500 974.048 C 2190.000 973.700, 1900.000 973.500, 1619.000 973.400 C 1338.000 973.500, 1048.000 973.700, 957.500 974.048 M 759.572 1686.750 C 759.638 2011.126, 759.779 2040.546, 761.325 2052.500 C 769.222 2113.555, 790.832 2169.475, 825.098 2217.517 C 884.291 2300.508, 973.931 2353.631, 1076 2366.206 C 1091.469 2368.112, 2146.495 2368.115, 2162 2366.209 C 2334 2345.069, 2465.588 2207.461, 2477.943 2035.813 C 2479.254 2017.594, 2479.437 1334, 2478.130 1334 C 2477.652 1334, 2287.414 1397.323, 2055.380 1474.718 L 1633.500 1615.436 1619 1615.428 L 1604.500 1615.419 1182.746 1474.709 C 950.782 1397.319, 760.657 1334, 760.246 1334 C 759.836 1334, 759.532 1492.738, 759.572 1686.750 M 901.011 1793.750 C 901.669 2081.511, 901.611 2076.824, 904.674 2091.840 C 918.542 2159.818, 976.504 2212.433, 1045.799 2219.947 C 1059.553 2221.439, 2179.841 2221.422, 2193.377 2219.930 C 2263.046 2212.251, 2318.553 2161.435, 2334.757 2090.500 L 2337.042 2080.500 2337.329 1799.250 C 2337.486 1644.563, 2337.328 1518, 2336.978 1518 C 2336.627 1518, 2180.795 1573.350, 1990.685 1641 L 1645.031 1764 1619.000 1764 L 1594.135 1764 1248.482 1641 C 1058.374 1573.350, 902.279 1518, 901.605 1518 C 900.641 1518, 900.514 1576.499, 901.011 1793.750";

function cortardoLogoSvg(size = 22): string {
  return `<svg viewBox="740 950 1760 1440" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle"><path d="${CORTARDO_LOGO_PATH}" fill="#1c1c1c" fill-rule="evenodd"/></svg>`;
}

// ─── Shared Layout ─────────────────────────────────────────────

const BASE_FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

function emailLayout(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #ffffff; font-family: ${BASE_FONT}; }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff">
  <tr>
    <td align="center" style="padding:40px 24px 48px">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:500px">

        <!-- Logo -->
        <tr>
          <td style="padding-bottom:36px">
            <a href="https://cortardo.com" style="text-decoration:none;display:inline-flex;align-items:center;gap:9px">
              ${cortardoLogoSvg(22)}
              <span style="font-family:${BASE_FONT};font-size:17px;font-weight:600;color:#1c1c1c;letter-spacing:-0.4px;line-height:1;vertical-align:middle">Cortardo</span>
            </a>
          </td>
        </tr>

        <!-- Content -->
        <tr>
          <td>
            ${bodyContent}
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding-top:40px">
            <hr style="border:none;border-top:1px solid #eaeaea;margin:0">
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:20px">
            <p style="margin:0 0 6px;font-family:${BASE_FONT};font-size:12px;color:#999999;line-height:1.5">
              You received this email because you have a Cortardo account.
            </p>
            <p style="margin:0;font-family:${BASE_FONT};font-size:12px;color:#999999;line-height:1.5">
              &copy; ${new Date().getFullYear()} Cortardo. All rights reserved. &mdash;
              <a href="https://cortardo.com" style="color:#999999;text-decoration:underline">cortardo.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Legacy markdown renderer (kept for ticket/user templates) ──

const CORTARDO_EMAIL_STYLES = `
  body { font-family:${BASE_FONT}; color:#000; line-height:1.6; font-size:14px; max-width:480px; margin:0 auto; padding:40px 24px 48px; background:#ffffff; }
  strong { font-weight:600; }
  em { font-style:italic; }
  ul, ol { margin:0 0 16px; padding-left:24px; }
  li { margin-bottom:4px; }
  a { color:#0070f3; }
  blockquote { margin:0 0 16px; padding:8px 16px; border-left:3px solid #eaeaea; color:#666666; }
  code { background:#f4f4f4; padding:2px 6px; border-radius:4px; font-size:13px; font-family:'SF Mono',Menlo,monospace; }
  pre { background:#f4f4f4; padding:12px 16px; border-radius:6px; overflow-x:auto; }
  hr { border:none; border-top:1px solid #eaeaea; margin:24px 0; }
  h1 { font-size:16px; font-weight:600; margin:0 0 6px; color:#000; }
  h2 { font-size:15px; font-weight:600; margin:0 0 10px; color:#000; }
  h3 { font-size:14px; font-weight:600; margin:0 0 8px; color:#000; }
  p { margin:0 0 12px; color:#000; }
`;

export { CORTARDO_EMAIL_STYLES };

export function renderMarkdown(md: string): string {
  const body = marked(md, { breaks: true, gfm: true }) as string;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CORTARDO_EMAIL_STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ─── HTML escape helper ────────────────────────────────────────

function he(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Shared content helpers ────────────────────────────────────

function heading(text: string): string {
  return `<h1 style="margin:0 0 20px;font-family:${BASE_FONT};font-size:24px;font-weight:600;color:#000000;letter-spacing:-0.5px;line-height:1.2">${text}</h1>`;
}

function paragraph(text: string, style = ""): string {
  return `<p style="margin:0 0 16px;font-family:${BASE_FONT};font-size:15px;color:#444444;line-height:1.6${style ? `;${style}` : ""}">${text}</p>`;
}

function link(href: string, label: string): string {
  return `<a href="${href}" style="color:#0070f3;text-decoration:none">${label}</a>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:24px 0;text-align:center">
  <div style="display:inline-block;background:#f4f4f4;border-radius:8px;padding:20px 32px">
    <span style="font-family:'SF Mono','Fira Code','Fira Mono','Roboto Mono',Menlo,monospace;font-size:28px;font-weight:600;color:#000000;letter-spacing:6px">${code}</span>
  </div>
</div>`;
}

function ctaButton(href: string, label: string): string {
  return `<div style="margin:24px 0">
  <a href="${href}" style="display:inline-block;background:#000000;color:#ffffff;font-family:${BASE_FONT};font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;padding:10px 20px;letter-spacing:-0.1px">${label}</a>
</div>`;
}

function infoTable(rows: { label: string; value: string }[]): string {
  const trs = rows.map(r => `
    <tr>
      <td style="padding:10px 0;font-family:${BASE_FONT};font-size:14px;font-weight:600;color:#000000;white-space:nowrap;padding-right:20px;vertical-align:top;border-bottom:1px solid #f0f0f0">${r.label}</td>
      <td style="padding:10px 0;font-family:${BASE_FONT};font-size:14px;color:#444444;vertical-align:top;border-bottom:1px solid #f0f0f0">${r.value}</td>
    </tr>`).join("");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0 24px"><tbody>${trs}</tbody></table>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #eaeaea;margin:28px 0">`;
}

// ─── Email Templates ───────────────────────────────────────────

export function buildVerificationTemplate(code: string): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading("Verify your email address")}
    ${paragraph("Use the code below to verify your email address and continue setting up your account.")}
    ${codeBlock(code)}
    ${paragraph("This code expires in 24 hours.", "font-size:14px;color:#999999")}
    ${paragraph("If you didn't create a Cortardo account, you can safely ignore this email.", "font-size:14px;color:#999999")}
  `);

  const text = `Verify your email address

Use the code below to verify your email address and continue setting up your account.

Code: ${code}

This code expires in 24 hours.

If you didn't create a Cortardo account, you can safely ignore this email.

— The Cortardo team`;

  return { html, text };
}

export function buildPinTemplate(pin: string): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading("Your Cortardo verification code")}
    ${paragraph("Use the code below to verify your email address and continue setting up your account.")}
    ${codeBlock(pin)}
    ${paragraph("This code expires in 10 minutes.", "font-size:14px;color:#999999")}
    ${paragraph("If you didn't request this code, you can safely ignore this email.", "font-size:14px;color:#999999")}
  `);

  const text = `Your Cortardo verification code

Use the code below to verify your email address.

Code: ${pin}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

— The Cortardo team`;

  return { html, text };
}

export function buildTwoFactorTemplate(link_url: string, code: string): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading("Your Cortardo sign-in code")}
    ${paragraph("Use the code below to finish signing in to your Cortardo account.")}
    ${codeBlock(code)}
    ${paragraph(`Or ${link(link_url, "click here to verify instantly")} &mdash; this link expires in 10 minutes.`)}
    ${divider()}
    ${paragraph("If this wasn't you, change your password immediately and review your account activity.", "font-size:14px;color:#999999")}
  `);

  const text = `Your Cortardo sign-in code

Use the code below to finish signing in to Cortardo.

Code: ${code}

Or verify instantly: ${link_url}

This code expires in 10 minutes.

If this wasn't you, change your password immediately and review account activity.

— The Cortardo team`;

  return { html, text };
}

export function buildPasswordResetTemplate(reset_link: string): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading("Reset your password")}
    ${paragraph("We received a request to reset the password for your Cortardo account. Click the button below to choose a new password.")}
    ${ctaButton(reset_link, "Reset password")}
    ${paragraph("Or copy and paste this link into your browser:")}
    ${paragraph(`<a href="${reset_link}" style="color:#0070f3;font-size:13px;word-break:break-all">${reset_link}</a>`, "font-size:13px")}
    ${paragraph("This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email &mdash; your password won't change.", "font-size:14px;color:#999999")}
  `);

  const text = `Reset your password

We received a request to reset the password for your Cortardo account.

Reset your password: ${reset_link}

This link expires in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password won't change.

— The Cortardo team`;

  return { html, text };
}

export function buildEmailChangeTemplate(confirm_link: string): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading("Confirm your new email address")}
    ${paragraph("Click the button below to confirm this as the new email address for your Cortardo account.")}
    ${ctaButton(confirm_link, "Confirm new email")}
    ${paragraph("This link expires in 24 hours.", "font-size:14px;color:#999999")}
    ${paragraph(`If you didn't request this change, please ${link("https://cortardo.com/account/security-auth", "secure your account")} immediately.`, "font-size:14px;color:#999999")}
  `);

  const text = `Confirm your new email address

Click the link below to confirm this as the new email address for your Cortardo account.

Confirm new email: ${confirm_link}

This link expires in 24 hours.

If you didn't request this change, please secure your account immediately: https://cortardo.com/account/security-auth

— The Cortardo team`;

  return { html, text };
}

export function buildNewDeviceTemplate(
  userName: string,
  userEmail: string,
  deviceInfo: { browser?: string; os?: string; ip?: string; location?: string; time?: string },
): ActionEmailTemplate {
  const browser = deviceInfo.browser || "Unknown browser";
  const os = deviceInfo.os || "Unknown OS";
  const ip = deviceInfo.ip || "Unknown IP";
  const location = deviceInfo.location || "Unknown location";
  const time = deviceInfo.time || new Date().toUTCString();

  const rows = [
    { label: "Location", value: he(location) },
    { label: "Time", value: he(time) },
    { label: "Browser", value: he(browser) },
    { label: "Device", value: he(os) },
    { label: "IP", value: he(ip) },
  ];

  const html = emailLayout(`
    ${heading("New sign-in detected")}
    ${paragraph(`Hello, <strong>${he(userName)}</strong>.`)}
    ${paragraph(`Your Cortardo account <a href="mailto:${he(userEmail)}" style="color:#0070f3;text-decoration:none">${he(userEmail)}</a> was recently signed in to from a new location, device, or browser:`)}
    ${infoTable(rows)}
    ${paragraph("<strong>Don't recognize this activity?</strong>")}
    ${paragraph(`${link("https://cortardo.com/account/security-auth", "Review your account security")} and ${link("https://cortardo.com/account", "manage your sessions")} now.`)}
    ${paragraph("This alert triggers when we detect a sign-in from an unrecognized location, device, or browser. Common causes: traveling, VPN or Private Relay, or a new browser.", "font-size:14px;color:#999999")}
  `);

  const text = `New sign-in detected

Hello, ${userName}.

Your Cortardo account ${userEmail} was recently signed in to from a new location, device, or browser:

Location: ${location}
Time: ${time}
Browser: ${browser}
Device: ${os}
IP: ${ip}

Don't recognize this activity? Review your account security at https://cortardo.com/account/security-auth

— The Cortardo team`;

  return { html, text };
}

export function buildWelcomeTemplate(
  name: string,
  details?: { workspaceName?: string },
): ActionEmailTemplate {
  const firstName = name.split(" ")[0] || name;

  const summaryRows: { label: string; value: string }[] = [];
  if (details?.workspaceName) summaryRows.push({ label: "Workspace", value: he(details.workspaceName) });

  const html = emailLayout(`
    ${heading(`Welcome to Cortardo, ${he(firstName)}`)}
    ${paragraph("Your workspace is all set up and ready to go. You can start sending and receiving email right away.")}
    ${summaryRows.length > 0 ? infoTable(summaryRows) : ""}
    ${ctaButton("https://cortardo.com/home/mail", "Go to inbox")}
    ${paragraph(`Need help getting started? Visit our ${link("https://cortardo.com/docs", "documentation")} or reply to this email.`, "font-size:14px;color:#999999")}
  `);

  const text = `Welcome to Cortardo, ${firstName}!

Your workspace${details?.workspaceName ? ` (${details.workspaceName})` : ""} is ready to go.

Go to inbox: https://cortardo.com/home/mail

Need help? Visit https://cortardo.com/docs

— The Cortardo team`;

  return { html, text };
}

export function buildSubscriptionUpdateTemplate(
  name: string,
  planName: string,
  action: "new" | "cancelled" | "updated",
  billingDate?: string,
): ActionEmailTemplate {
  const firstName = name.split(" ")[0] || name;
  const safeName = he(firstName);
  const safePlan = he(planName);
  const safeBillingDate = billingDate ? he(billingDate) : undefined;

  let title: string;
  let bodyText: string;
  let ctaLabel: string;
  let ctaHref: string;

  if (action === "new") {
    title = `You're now on the ${safePlan} plan`;
    bodyText = `Thanks for subscribing, ${safeName}. Your ${safePlan} plan is now active and all features are available on your account.`;
    ctaLabel = "Manage subscription";
    ctaHref = "https://cortardo.com/account/billing";
  } else if (action === "cancelled") {
    title = "Your subscription has been cancelled";
    bodyText = `Hi ${safeName}, your Cortardo subscription has been cancelled. You'll continue to have access to ${safePlan} features until the end of your current billing period.`;
    ctaLabel = "Reactivate subscription";
    ctaHref = "https://cortardo.com/account/billing";
  } else {
    title = `Your plan has been updated to ${safePlan}`;
    bodyText = `Hi ${safeName}, your Cortardo subscription has been updated to the ${safePlan} plan.`;
    ctaLabel = "View billing details";
    ctaHref = "https://cortardo.com/account/billing";
  }

  const rows: { label: string; value: string }[] = [
    { label: "Plan", value: safePlan },
    ...(action === "new" || action === "updated" ? [{ label: "Status", value: "Active" }] : [{ label: "Status", value: "Cancelled" }]),
    ...(safeBillingDate ? [{ label: action === "cancelled" ? "Access until" : "Next billing date", value: safeBillingDate }] : []),
  ];

  const html = emailLayout(`
    ${heading(title)}
    ${paragraph(bodyText)}
    ${infoTable(rows)}
    ${ctaButton(ctaHref, ctaLabel)}
    ${paragraph(`Questions about your billing? ${link("https://cortardo.com/support", "Contact support")}.`, "font-size:14px;color:#999999")}
  `);

  const text = `${title}

${bodyText}

Plan: ${planName}
Status: ${action === "cancelled" ? "Cancelled" : "Active"}${billingDate ? `\n${action === "cancelled" ? "Access until" : "Next billing date"}: ${billingDate}` : ""}

Manage your subscription: ${ctaHref}

— The Cortardo team`;

  return { html, text };
}

export function buildAccountDeletionTemplate(name: string, email: string): ActionEmailTemplate {
  const firstName = name.split(" ")[0] || name;

  const html = emailLayout(`
    ${heading("Your account has been deleted")}
    ${paragraph(`Hi ${he(firstName)}, your Cortardo account associated with <strong>${he(email)}</strong> has been permanently deleted.`)}
    ${paragraph("All your data, workspaces, inboxes, and settings have been removed from our systems. This action cannot be undone.")}
    ${divider()}
    ${paragraph("If you deleted your account by mistake or believe this was unauthorized, please contact us immediately.", "font-size:14px;color:#999999")}
    ${paragraph(`<a href="mailto:support@cortardo.com" style="color:#0070f3;text-decoration:none">support@cortardo.com</a>`, "font-size:14px;color:#999999")}
  `);

  const text = `Your account has been deleted

Hi ${firstName}, your Cortardo account associated with ${email} has been permanently deleted.

All your data, workspaces, inboxes, and settings have been removed from our systems. This action cannot be undone.

If you deleted your account by mistake or believe this was unauthorized, please contact us immediately at support@cortardo.com.

— The Cortardo team`;

  return { html, text };
}

export function buildWorkspaceInviteTemplate(
  invitedByName: string,
  workspaceName: string,
  inviteUrl: string,
): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading(`You've been invited to ${he(workspaceName)}`)}
    ${paragraph(`<strong>${he(invitedByName)}</strong> has invited you to join their workspace on Cortardo.`)}
    ${ctaButton(inviteUrl, "Accept invitation")}
    ${paragraph("Or copy and paste this link into your browser:")}
    ${paragraph(`<a href="${he(inviteUrl)}" style="color:#0070f3;font-size:13px;word-break:break-all">${he(inviteUrl)}</a>`, "font-size:13px")}
    ${paragraph("This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.", "font-size:14px;color:#999999")}
  `);

  const text = `You've been invited to ${workspaceName}

${invitedByName} has invited you to join their workspace on Cortardo.

Accept invitation: ${inviteUrl}

This invitation expires in 7 days.

— The Cortardo team`;

  return { html, text };
}

export function buildMemberAcceptedInviteTemplate(
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  role: string,
): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading(`${he(memberName)} joined ${he(workspaceName)}`)}
    ${paragraph(`${he(memberName)} has <strong>accepted the invitation</strong> and is now a member of your workspace.`)}
    ${infoTable([
      { label: "Member", value: `${he(memberName)} <${he(memberEmail)}>` },
      { label: "Role", value: he(role) },
      { label: "Workspace", value: he(workspaceName) },
    ])}
    ${paragraph(`You can review and manage workspace members in your ${link("https://cortardo.com/workspaces", "workspace settings")}.`, "font-size:14px;color:#999999")}
  `);

  const text = `${memberName} joined ${workspaceName}

${memberName} has accepted the invitation and is now a member of your workspace.

Member: ${memberName} <${memberEmail}>
Role: ${role}
Workspace: ${workspaceName}

Manage members: https://cortardo.com/workspaces

— The Cortardo team`;

  return { html, text };
}

export function buildMemberDeclinedInviteTemplate(
  workspaceName: string,
  memberName: string,
  memberEmail: string,
): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading(`${he(memberName)} declined the invitation`)}
    ${paragraph(`${he(memberName)} has <strong>declined the invitation</strong> to join ${he(workspaceName)}. They won't be added as a member.`)}
    ${infoTable([
      { label: "Member", value: `${he(memberName)} <${he(memberEmail)}>` },
      { label: "Status", value: "Declined" },
      { label: "Workspace", value: he(workspaceName) },
    ])}
    ${paragraph(`You can send them a new invitation from your ${link("https://cortardo.com/workspaces", "workspace settings")} at any time.`, "font-size:14px;color:#999999")}
  `);

  const text = `${memberName} declined the invitation

${memberName} has declined the invitation to join ${workspaceName}. They won't be added as a member.

Member: ${memberName} <${memberEmail}>
Status: Declined
Workspace: ${workspaceName}

You can send a new invitation from your workspace settings at any time.

— The Cortardo team`;

  return { html, text };
}

export function buildMemberLeftWorkspaceTemplate(
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  role: string,
): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading(`${he(memberName)} left ${he(workspaceName)}`)}
    ${paragraph(`${he(memberName)} has <strong>left the workspace</strong> and no longer has access to ${he(workspaceName)}.`)}
    ${infoTable([
      { label: "Member", value: `${he(memberName)} <${he(memberEmail)}>` },
      { label: "Previous role", value: he(role) },
      { label: "Workspace", value: he(workspaceName) },
    ])}
    ${paragraph(`You can review the current members in your ${link("https://cortardo.com/workspaces", "workspace settings")}.`, "font-size:14px;color:#999999")}
  `);

  const text = `${memberName} left ${workspaceName}

${memberName} has left the workspace and no longer has access to ${workspaceName}.

Member: ${memberName} <${memberEmail}>
Previous role: ${role}
Workspace: ${workspaceName}

Review members: https://cortardo.com/workspaces

— The Cortardo team`;

  return { html, text };
}

export function buildMemberRemovedTemplate(
  workspaceName: string,
  memberName: string,
  memberEmail: string,
  removedBy: string,
): ActionEmailTemplate {
  const html = emailLayout(`
    ${heading(`${he(memberName)} was removed from ${he(workspaceName)}`)}
    ${paragraph(`${he(removedBy)} has <strong>removed</strong> ${he(memberName)} from ${he(workspaceName)}. They no longer have access to the workspace.`)}
    ${infoTable([
      { label: "Member", value: `${he(memberName)} <${he(memberEmail)}>` },
      { label: "Removed by", value: he(removedBy) },
      { label: "Workspace", value: he(workspaceName) },
    ])}
    ${paragraph(`You can review the current members in your ${link("https://cortardo.com/workspaces", "workspace settings")}.`, "font-size:14px;color:#999999")}
  `);

  const text = `${memberName} was removed from ${workspaceName}

${removedBy} has removed ${memberName} from ${workspaceName}. They no longer have access to the workspace.

Member: ${memberName} <${memberEmail}>
Removed by: ${removedBy}
Workspace: ${workspaceName}

Review members: https://cortardo.com/workspaces

— The Cortardo team`;

  return { html, text };
}

export function buildTicketCreatedTemplate(
  name: string,
  subject: string,
  ticketId: string,
  spaceName?: string,
): ActionEmailTemplate {
  const firstName = name.split(" ")[0] ?? "there";
  const supportName = spaceName || "Support";
  const text = `Hi ${firstName},

We received your message and have opened a ticket for your request.

Ticket: ${ticketId}
Subject: ${subject}

We'll review your request and get back to you as soon as possible. You can reply to this email to add more information to your ticket.

— ${supportName}`;

  const html = renderMarkdown(text);
  return { html, text };
}

export function buildTicketFooter(ticketId: string): string {
  return `\n\n---\nTicket ID: #${ticketId} — Track this ticket in your Cortardo dashboard.\nThis email is ticketed by Cortardo (https://cortardo.com)`;
}
