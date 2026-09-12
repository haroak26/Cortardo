import { Layout } from "@/components/Layout";
import { LandingHero } from "@/components/marketing";

export default function Privacy() {
  return (
    <Layout fullWidth>
      <LandingHero
        eyebrowLabel="Legal"
        eyebrow="Privacy Policy"
        title="Privacy Policy"
        description="Last updated: June 24, 2026"
      />

      <section className="pb-24">
        <div className="lds-marketing-section">
          <div className="max-w-3xl">
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">

              <h2 className="text-base font-semibold text-foreground pt-4">1) Who we are</h2>
              <p>Cortardo is a code review platform operated by Cortardo.</p>
              <p>For data protection matters, you can contact us at:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Data Protection Officer:</strong> dpo@cortardo.com</li>
                <li><strong className="text-foreground">Privacy enquiries:</strong> privacy@cortardo.com</li>
                <li><strong className="text-foreground">Security reports:</strong> security@cortardo.com</li>
                <li><strong className="text-foreground">General:</strong> hello@cortardo.com</li>
              </ul>
              <p>Cortardo is the data controller for personal data collected through your use of the Service, except where we process data on your behalf as a data processor (see Section 6).</p>

              <h2 className="text-base font-semibold text-foreground pt-4">2) Information we collect</h2>
              <p>We collect and process personal data across several categories depending on how you interact with Cortardo.</p>

              <h3 className="text-sm font-semibold text-foreground pt-3">2.1 Account and profile data</h3>
              <p>When you sign up for a Cortardo account, we collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Email address (required, normalised to lowercase)</li>
                <li>Password (hashed with scrypt and a unique salt — never stored in plaintext)</li>
                <li>Username (auto-generated from email or OAuth profile)</li>
                <li>Display name and avatar image (optional)</li>
                <li>Google ID (if you authenticate via OAuth)</li>
                <li>Email verification status and verification tokens</li>
                <li>TOTP secret key (if you enable two-factor authentication)</li>
                <li>Theme preference (system, light, or dark)</li>
                <li>Onboarding progress indicators</li>
                <li>Communication preferences for newsletter, product updates, security alerts, and billing updates (default: all subscribed)</li>
              </ul>

              <h3 className="text-sm font-semibold text-foreground pt-3">2.2 Workspace and team data</h3>
              <p>When you create or join a workspace, we collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Workspace name and domain name(s)</li>
                <li>Workspace logo or brand assets</li>
                <li>Team member names, email addresses, phone numbers, job titles, and departments</li>
                <li>Role assignments (owner, editor, viewer) and permissions</li>
                <li>Team member skills, proficiency ratings, and availability schedules</li>
                <li>Timezone configuration and notification preferences for each member</li>
                <li>Member activity logs and audit trails</li>
              </ul>

              <h3 className="text-sm font-semibold text-foreground pt-3">2.3 Project and review data</h3>
              <p>When you create projects and use the review agent, we collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Project names, descriptions, and colour labels</li>
                <li>Review prompts and rules you submit to the agent</li>
                <li>Clarification questions, answers, agent reasoning, and plans</li>
                <li>Generated findings, summaries, and suggested fixes</li>
              </ul>


              <h3 className="text-sm font-semibold text-foreground pt-3">2.4 Billing and subscription data</h3>
              <p>When you subscribe to a paid plan, we process:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Plan tier and billing period selection</li>
                <li>Stripe customer identifier and subscription identifier (we do not process or store full payment card numbers)</li>
                <li>Payment history and invoice records</li>
                <li>Usage metrics for billing purposes (emails sent/received, AI credits consumed, member counts)</li>
                <li>Third-party API integration keys for alternative billing providers if configured</li>
              </ul>

              <h3 className="text-sm font-semibold text-foreground pt-3">2.5 Session and device data</h3>
              <p>When you use the Cortardo web application, we automatically collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>IP address (used for session tracking, security monitoring, and rate limiting)</li>
                <li>Browser type, operating system, and device type</li>
                <li>Approximate geographic location derived from IP address</li>
                <li>Session identifiers stored in HTTP-only cookies</li>
                <li>Page view and interaction data via Vercel Analytics (session and visitor identifiers)</li>
                <li>Performance metrics via Vercel Speed Insights</li>
                <li>Last active timestamp for session management</li>
              </ul>

              <h2 className="text-base font-semibold text-foreground pt-4">3) How we use information</h2>
              <p>We use your personal data for the following purposes:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Service delivery:</strong> to create and maintain your account, process your workspace configuration, generate AI review responses, and deliver all features of the platform.</li>
                <li><strong className="text-foreground">Security and abuse prevention:</strong> to detect and prevent unauthorised access, spam, phishing, denial-of-service attacks, and other malicious activity. This includes rate limiting, session validation, and audit logging.</li>
                <li><strong className="text-foreground">Customer support:</strong> to respond to your enquiries, troubleshoot technical issues, and provide guidance on using Cortardo.</li>
                <li><strong className="text-foreground">Service improvement:</strong> to analyse aggregated usage patterns, identify bugs, and improve platform performance and reliability. Aggregated analytics are stripped of personal identifiers.</li>
                <li><strong className="text-foreground">Billing and account management:</strong> to process payments, send invoices, manage subscription renewals, and communicate about billing matters.</li>
                <li><strong className="text-foreground">Product communications:</strong> to send service-related notices (security alerts, maintenance windows, policy changes) and, with your consent, product updates and marketing communications. You can opt out of marketing at any time via your account settings or the unsubscribe link in emails.</li>
                <li><strong className="text-foreground">Compliance:</strong> to meet our legal and regulatory obligations, including tax record-keeping and responding to lawful data access requests.</li>
              </ul>
              <p>We do not sell your personal data. We do not use your data for automated decision-making that produces legal effects concerning you, except as necessary to provide the AI review features you explicitly use.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">4) Legal basis for processing (UK GDPR / EU GDPR)</h2>
              <p>Where the UK GDPR or EU GDPR applies, we rely on the following lawful bases:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Contract performance (Article 6(1)(b)):</strong> most account and service data is processed because it is necessary to perform our contract with you — to provide the Cortardo platform as requested.</li>
                <li><strong className="text-foreground">Legitimate interests (Article 6(1)(f)):</strong> we rely on legitimate interests for security monitoring, fraud prevention, service improvement, and direct marketing to existing customers where applicable. We balance these against your rights and interests and you may object at any time.</li>
                <li><strong className="text-foreground">Consent (Article 6(1)(a)):</strong> where we rely on consent (for example, certain marketing communications or cookie preferences), you can withdraw consent at any time without affecting the lawfulness of processing before withdrawal.</li>
                <li><strong className="text-foreground">Legal obligation (Article 6(1)(c)):</strong> we process certain data (such as billing records) to comply with tax, anti-money laundering, and other legal obligations.</li>
              </ul>

              <h2 className="text-base font-semibold text-foreground pt-4">5) Cookies and tracking technologies</h2>
              <p>We use the following cookies and similar technologies:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Session cookie (connect.sid):</strong> required for authentication. This is an HTTP-only, SameSite cookie with a 7-day expiry. It stores a signed session identifier linked to your authenticated session on the server.</li>
                <li><strong className="text-foreground">Local storage (cortardo_cookie_consent):</strong> stores your cookie consent preference (accepted or declined) to avoid re-prompting.</li>
                <li><strong className="text-foreground">Vercel Analytics:</strong> uses session-level and visitor-level identifiers (stored in local storage) for aggregated page view counting. No cross-site tracking or personal data profiling is performed.</li>
                <li><strong className="text-foreground">Vercel Speed Insights:</strong> collects performance metrics about page load times to help us identify optimisation opportunities. This data is aggregated and not linked to personal identities.</li>
              </ul>
              <p>We do not use third-party advertising cookies, tracking pixels, or behavioural advertising technologies. You can manage cookie preferences via our cookie consent bar on first visit, or by clearing your browser cookies and local storage at any time.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">6) Data sharing and subprocessors</h2>
              <p>We share personal data only with service providers who need it to operate the platform. Each subprocessor is contractually bound to process data only on our documented instructions, maintain appropriate security measures, and flow down the same obligations.</p>

              <h3 className="text-sm font-semibold text-foreground pt-3">6.1 Current subprocessors</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 pr-4 font-semibold text-foreground">Subprocessor</th>
                      <th className="py-2 pr-4 font-semibold text-foreground">Purpose</th>
                      <th className="py-2 font-semibold text-foreground">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4">Stripe, Inc.</td>
                      <td className="py-2 pr-4">Payment processing, subscription management, invoicing</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Brevo (Sendinblue SAS)</td>
                      <td className="py-2 pr-4">Transactional email delivery (password resets, notifications)</td>
                      <td className="py-2">France</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">OpenAI, LLC</td>
                      <td className="py-2 pr-4">AI code review agent generation (findings, summaries, and fix proposals)</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Vercel Inc.</td>
                      <td className="py-2 pr-4">Hosting, file/blob storage, analytics, speed insights</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Neon (Neon Tech Inc.)</td>
                      <td className="py-2 pr-4">PostgreSQL database hosting (serverless)</td>
                      <td className="py-2">United States / EU (multi-region)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-sm font-semibold text-foreground pt-3">6.2 Review project data (data processor role)</h3>
              <p>When you use Cortardo to process review prompts and generated findings, Cortardo acts as a <strong className="text-foreground">data processor</strong> on your behalf. You remain the data controller for that customer data. Our Data Processing Addendum (DPA) is incorporated into our Terms of Service and is available upon request by contacting privacy@cortardo.com.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">7) Data retention</h2>
              <p>We retain personal data only as long as necessary to fulfil the purposes for which it was collected, or as required by applicable law.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Account data:</strong> retained while your account is active. You may delete your account at any time from Account Settings. Upon deletion, account data is deleted or anonymised within 30 days, except as noted below.</li>
                <li><strong className="text-foreground">Workspace data:</strong> retained while the workspace is active. Deleting a workspace removes associated data within 30 days.</li>
                <li><strong className="text-foreground">Project and review data:</strong> retained until the associated project or workspace is deleted. You may export or delete individual projects at any time.</li>
                <li><strong className="text-foreground">Billing records:</strong> retained for 7 years following the end of the financial year in which the transaction occurred, as required by UK tax law.</li>
                <li><strong className="text-foreground">Session logs and audit trails:</strong> retained for 90 days, then aggregated or anonymised for security trend analysis.</li>
                <li><strong className="text-foreground">Agent run logs:</strong> retained while the project is active, or until deleted by the workspace owner.</li>
                <li><strong className="text-foreground">Marketing preferences:</strong> retained until you opt out or delete your account.</li>
              </ul>

              <h2 className="text-base font-semibold text-foreground pt-4">8) Data security</h2>
              <p>We implement technical and organisational measures to protect your personal data, including:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Password hashing using scrypt with per-user unique salts — plaintext passwords are never stored</li>
                <li>Full TLS 1.2+ encryption for all data in transit between clients and our servers, and between our servers and third-party services</li>
                <li>Encryption at rest for database storage</li>
                <li>HTTP-only, SameSite session cookies with a 7-day expiry</li>
                <li>Rate limiting on authentication endpoints (20 requests per 15-minute rolling window per IP)</li>
                <li>Rate limiting on all API routes to prevent abuse and brute-force attacks</li>
                <li>Two-factor authentication (TOTP) and email-based 2FA for account security</li>
                <li>New device detection with email notification</li>
                <li>Session tracking and revocation — you can view and terminate active sessions from your Account settings</li>
                <li>Regular access reviews and least-privilege access for Cortardo employees and contractors</li>
                <li>Annual security awareness training for all personnel with access to production systems</li>
              </ul>
              <p>While we implement these measures, no method of electronic storage or transmission is 100% secure. We encourage you to use strong, unique passwords and enable two-factor authentication.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">9) International data transfers</h2>
              <p>Your data may be processed in the United Kingdom, the European Economic Area, and the United States, where our hosting providers and subprocessers operate.</p>
              <p>Where we transfer personal data from the UK or EEA to a country without an adequacy decision (such as the United States), we rely on:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Standard Contractual Clauses (SCCs)</strong> as adopted by the European Commission under Implementing Decision 2021/914 and the UK International Data Transfer Addendum (IDTA) issued by the Information Commissioner's Office under Section 119A of the Data Protection Act 2018.</li>
                <li>Where a subprocessor is self-certified under the <strong className="text-foreground">UK-US Data Bridge</strong> or <strong className="text-foreground">EU-US Data Privacy Framework</strong>, we rely on that certification as an adequate transfer mechanism.</li>
              </ul>
              <p>You may request a copy of the relevant transfer safeguards by contacting privacy@cortardo.com.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">10) Your rights and choices</h2>
              <p>Depending on your location, you have the following rights regarding your personal data. You can exercise most of them directly from your Account settings page or by emailing privacy@cortardo.com.</p>

              <h3 className="text-sm font-semibold text-foreground pt-3">10.1 UK GDPR / EU GDPR rights</h3>
              <p>If you are located in the UK or European Economic Area, you have the right to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Access (Article 15):</strong> request a copy of the personal data we hold about you.</li>
                <li><strong className="text-foreground">Rectification (Article 16):</strong> correct inaccurate or incomplete data.</li>
                <li><strong className="text-foreground">Erasure (Article 17):</strong> request deletion of your data — you can also do this directly via Account Settings &gt; Danger Zone.</li>
                <li><strong className="text-foreground">Restriction (Article 18):</strong> restrict processing of your data while a dispute is being resolved.</li>
                <li><strong className="text-foreground">Portability (Article 20):</strong> receive your data in a structured, machine-readable format (JSON export available from Account Settings &gt; Data).</li>
                <li><strong className="text-foreground">Objection (Article 21):</strong> object to processing based on legitimate interests, including direct marketing.</li>
                <li><strong className="text-foreground">Withdraw consent:</strong> where processing is based on consent, you may withdraw at any time without affecting the lawfulness of processing before withdrawal.</li>
                <li><strong className="text-foreground">Lodge a complaint:</strong> with the Information Commissioner's Office (ICO) in the UK or your local supervisory authority in the EEA.</li>
              </ul>

              <h3 className="text-sm font-semibold text-foreground pt-3">10.2 California rights (CCPA/CPRA)</h3>
              <p>If you are a California resident, the California Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA) grants you the right to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Know:</strong> request disclosure of the categories and specific pieces of personal data we collect, use, and disclose.</li>
                <li><strong className="text-foreground">Correction:</strong> request correction of inaccurate personal data.</li>
                <li><strong className="text-foreground">Deletion:</strong> request deletion of personal data we have collected from you, subject to certain exceptions.</li>
                <li><strong className="text-foreground">Non-discrimination:</strong> we will not discriminate against you for exercising any of your CCPA/CPRA rights.</li>
                <li><strong className="text-foreground">Opt out of sale/sharing:</strong> Cortardo does not sell personal data and does not share personal data for cross-context behavioural advertising.</li>
                <li><strong className="text-foreground">Limit use of sensitive personal data:</strong> Cortardo only uses sensitive personal data as necessary to provide the Service.</li>
              </ul>
              <p>You may exercise your California rights by emailing privacy@cortardo.com or using the self-service tools in Account Settings. We will verify your identity before processing your request using the information associated with your account.</p>

              <h3 className="text-sm font-semibold text-foreground pt-3">10.4 Data export and deletion</h3>
              <p>All users can:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Export data:</strong> download your account data as JSON from Account &gt; Data. This includes your profile, workspace membership, and configuration data.</li>
                <li><strong className="text-foreground">Delete account:</strong> permanently delete your account and all associated data from Account &gt; Danger Zone. This action is irreversible after 30 days.</li>
              </ul>

              <h2 className="text-base font-semibold text-foreground pt-4">11) Children's privacy</h2>
              <p>Cortardo is not directed to children under the age of 13 (or 16 in the European Economic Area and UK where a higher age threshold applies). We do not knowingly collect personal data from children. If you believe a child has provided us with personal data, please contact us at privacy@cortardo.com and we will investigate and delete the data promptly.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">12) Changes to this policy</h2>
              <p>We may update this Privacy Policy from time to time. If we make material changes, we will notify you by email (to the address associated with your account) or through an in-app notification at least 14 days before the changes take effect. The "Last updated" date at the top of this policy reflects the most recent revision. Your continued use of Cortardo after the effective date constitutes acceptance of the updated policy.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">13) Contact and complaints</h2>
              <p>If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">Data Protection Officer:</strong> dpo@cortardo.com</li>
                <li><strong className="text-foreground">Privacy team:</strong> privacy@cortardo.com</li>
                <li><strong className="text-foreground">Security:</strong> security@cortardo.com</li>
                <li><strong className="text-foreground">Post:</strong> Available upon request</li>
              </ul>
              <p>If you are in the UK, you have the right to lodge a complaint with the Information Commissioner's Office (ICO):</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Website: <a href="https://ico.org.uk" className="text-foreground underline">ico.org.uk</a></li>
                <li>Post: Information Commissioner's Office, Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF</li>
                <li>Helpline: 0303 123 1113</li>
              </ul>
              <p>If you are in the EEA, you may lodge a complaint with your local supervisory authority.</p>

            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
