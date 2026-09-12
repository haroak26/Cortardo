import { Layout } from "@/components/Layout";
import { LandingHero } from "@/components/marketing";

export default function Terms() {
  return (
    <Layout fullWidth>
      <LandingHero
        eyebrowLabel="Legal"
        eyebrow="Terms of Service"
        title="Terms of Service"
        description="Last updated: June 24, 2026"
      />

      <section className="pb-24">
        <div className="lds-marketing-section">
          <div className="max-w-3xl">
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">

              <p>These Terms of Service ("Terms") govern your access to and use of the Cortardo code review platform, website, and related services (collectively, the "Service") operated by Cortardo ("Cortardo", "we", "us", or "our").</p>
              <p>By accessing or using the Service, you ("you" or "Customer") agree to be bound by these Terms. If you are entering into these Terms on behalf of an organisation, you represent and warrant that you have the authority to bind that organisation. If you do not agree to these Terms, you must not access or use the Service.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">1) Eligibility and account registration</h2>
              <p>1.1 You must be at least 18 years old to use the Service. By creating an account, you represent that you are at least 18 and that all information you provide is accurate, current, and complete.</p>
              <p>1.2 You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately at security@cortardo.com of any unauthorised use of your account or any other breach of security.</p>
              <p>1.3 You may not create multiple accounts for the purpose of circumventing plan limits, restrictions, or suspension actions. Each individual may hold only one Cortardo account.</p>
              <p>1.4 We reserve the right to refuse registration, suspend accounts, or terminate access at our discretion where we reasonably believe continued access would violate applicable law or these Terms.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">2) Acceptable use</h2>
              <p>2.1 You agree not to, and not to permit others to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Use the Service for any unlawful purpose or in violation of any applicable local, national, or international law or regulation;</li>
                <li>Send or store spam, unsolicited commercial messages, or unlawful communications through the Service;</li>
                <li>Upload, transmit, or store any content that is defamatory, obscene, harassing, discriminatory, or otherwise objectionable;</li>
                <li>Attempt to gain unauthorised access to any part of the Service, other accounts, or any connected networks or systems;</li>
                <li>Interfere with or disrupt the integrity or performance of the Service, including introducing malware, viruses, or other harmful code;</li>
                <li>Reverse engineer, decompile, disassemble, or otherwise attempt to derive source code of the Service (except to the extent expressly permitted by applicable law);</li>
                <li>Use the Service in any way that could overburden, damage, or impair our infrastructure, including conducting denial-of-service attacks or excessive automated requests;</li>
                <li>Use the Service to infringe the intellectual property rights or privacy rights of any third party;</li>
                <li>Access the Service through automated means (scraping, crawling, bots) without our prior written consent;</li>
                <li>Circumvent any rate limits, access restrictions, or other usage controls we implement.</li>
              </ul>
              <p>2.2 We reserve the right to investigate and take appropriate action, including suspension or termination of your account, if you violate this Acceptable Use Policy.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">3) Customer data and compliance responsibilities</h2>
              <p>3.1 You retain all right, title, and interest in and to the data, content, and materials you submit, upload, or transmit through the Service ("Customer Data"). You grant Cortardo a limited, non-exclusive licence to access, use, process, copy, store, and transmit Customer Data solely as necessary to provide the Service to you.</p>
              <p>3.2 You are solely responsible for the accuracy, quality, legality, and appropriateness of Customer Data. You represent and warrant that:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>You have all necessary rights and consents to submit Customer Data to the Service;</li>
                <li>Customer Data does not violate any applicable law or third-party rights;</li>
                <li>You have provided adequate privacy notices to, and obtained necessary consents from, your customers and end users whose personal data is processed through the Service;</li>
                <li>You will comply with all applicable data protection laws in your use of the Service.</li>
              </ul>
              <p>3.3 Where Cortardo processes Customer Data that constitutes personal data under UK GDPR or EU GDPR on your behalf, Cortardo acts as a data processor. The parties agree to the Data Processing Addendum (DPA), which is incorporated into these Terms by reference. A copy of the DPA is available upon request by emailing privacy@cortardo.com.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">4) Plans, billing, and renewals</h2>
              <p>4.1 <strong className="text-foreground">Plan tiers.</strong> The Service is offered on a subscription basis with multiple plan tiers (including Dev, Startup, and Scale). The features, limits, and pricing for each plan are described on our pricing page at cortardo.com/pricing, which forms part of these Terms.</p>
              <p>4.2 <strong className="text-foreground">Free trial.</strong> We may offer free trials of paid plans. At the end of the trial period, you will be automatically converted to the corresponding paid plan unless you cancel before the trial expires. We will send at least one email reminder before charging.</p>
              <p>4.3 <strong className="text-foreground">Billing.</strong> Paid plans are billed monthly in advance. Fees are non-refundable except as expressly stated in Section 4.7. All fees are exclusive of applicable taxes (VAT, sales tax, etc.), which will be added at checkout where required by law.</p>
              <p>4.4 <strong className="text-foreground">Automatic renewal.</strong> Subscriptions renew automatically each billing period unless you cancel before the renewal date. You may cancel at any time from the Billing page in your account settings. Upon cancellation, your access continues until the end of the current paid billing period — no partial refunds are provided for unused time.</p>
              <p>4.5 <strong className="text-foreground">Plan upgrades and downgrades.</strong> Upgrading to a higher-tier plan takes effect immediately and you will be charged the prorated difference for the remainder of the billing period. Downgrading to a lower-tier plan takes effect at the start of the next billing period. Usage exceeding the new plan's limits during a downgrade may result in service restrictions.</p>
              <p>4.6 <strong className="text-foreground">Payment method.</strong> You must provide a valid payment method (credit/debit card via Stripe). You authorise us to charge that payment method for all fees incurred. If a payment fails, we will notify you and attempt the charge again. After three failed attempts within 14 days, we may suspend access to paid features until payment is successfully processed.</p>
              <p>4.7 <strong className="text-foreground">Fee changes.</strong> We may change our fees with 30 days' notice. Price increases will not apply during your current billing period — they take effect at the start of your next billing period after the notice period. If you do not agree to the price change, you may cancel before it takes effect.</p>
              <p>4.8 <strong className="text-foreground">Refunds.</strong> Fees are non-refundable except where required by applicable consumer law or where we materially fail to provide the Service as described. In such cases, refunds will be prorated for the unused portion of the billing period.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">5) Service availability and support</h2>
              <p>5.1 <strong className="text-foreground">Uptime commitment.</strong> We use commercially reasonable efforts to ensure the Service is available with 99.5% uptime, calculated on a monthly basis excluding scheduled maintenance and events beyond our reasonable control. Scheduled maintenance will be communicated at least 48 hours in advance where practicable.</p>
              <p>5.2 <strong className="text-foreground">Support.</strong> We provide technical support via email (hello@cortardo.com) and through in-app chat during business hours. Response times depend on your plan tier and are described on our pricing page. We do not guarantee resolution of specific issues within a fixed timeframe.</p>
              <p>5.3 <strong className="text-foreground">No critical use.</strong> The Service is not designed or intended for use in environments where failure or delay could result in death, personal injury, or severe property or environmental damage (including healthcare systems, life support, nuclear facilities, or emergency services). You agree not to use the Service for such purposes.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">6) Third-party services and integrations</h2>
              <p>6.1 The Service integrates with third-party services including Stripe (payment processing), Brevo (transactional email), OpenAI (AI agent services), and Mistral AI (document OCR). Your use of these integrations is subject to their respective terms of service and privacy policies.</p>
              <p>6.2 We are not responsible for the availability, security, or performance of third-party services. Changes to third-party APIs or discontinuation of third-party services may affect Cortardo's functionality. We will make reasonable efforts to notify you of such impacts and, where feasible, provide alternative integration options.</p>
              <p>6.3 The Service may enable you to configure webhooks for custom integrations. You are responsible for securing your webhook endpoints and for all data transmitted through webhooks.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">7) Intellectual property</h2>
              <p>7.1 <strong className="text-foreground">Cortardo IP.</strong> The Service, including its software, design, branding, trademarks (including "Cortardo" and the Cortardo logo), documentation, and all intellectual property rights therein, are owned by Cortardo Technologies Ltd or our licensors. These Terms do not grant you any ownership rights in the Service. You may not copy, modify, create derivative works of, or sublicense any part of the Service except as expressly permitted in these Terms.</p>
              <p>7.2 <strong className="text-foreground">Customer IP.</strong> You retain all ownership rights in Customer Data and any content you submit to the Service. We do not claim ownership over your Customer Data.</p>
              <p>7.3 <strong className="text-foreground">Feedback.</strong> If you provide us with suggestions, enhancement requests, recommendations, or other feedback regarding the Service, we may use such feedback without any obligation to you.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">8) Confidentiality</h2>
              <p>8.1 Each party may have access to confidential information of the other party in connection with these Terms. "Confidential Information" means any non-public information disclosed by one party to the other, whether orally or in writing, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure.</p>
              <p>8.2 The receiving party agrees to: (a) maintain the confidentiality of the disclosing party's Confidential Information using at least the same degree of care it uses to protect its own similar information; (b) not disclose such information to any third party except as necessary to perform its obligations under these Terms; and (c) not use such information for any purpose other than performing its obligations under these Terms.</p>
              <p>8.3 Confidential Information does not include information that: (a) is or becomes publicly available through no fault of the receiving party; (b) was rightfully in the receiving party's possession before disclosure; (c) is rightfully received from a third party without restriction; or (d) is independently developed by the receiving party without use of the disclosing party's Confidential Information.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">9) Suspension and termination</h2>
              <p>9.1 <strong className="text-foreground">Termination by you.</strong> You may delete your account at any time from Account Settings &gt; Danger Zone. Termination takes effect immediately, subject to the 30-day data deletion window described in our Privacy Policy.</p>
              <p>9.2 <strong className="text-foreground">Suspension by us.</strong> We may suspend your access to the Service immediately without notice if: (a) you materially breach these Terms; (b) your use of the Service poses a security risk to the Service or other users; (c) we suspect fraudulent or illegal activity associated with your account; or (d) you fail to pay fees when due and do not cure within 14 days of notice.</p>
              <p>9.3 <strong className="text-foreground">Termination by us.</strong> We may terminate these Terms and your access to the Service for cause with 30 days' written notice if a material breach remains uncured after the notice period. We may also terminate immediately if cure is not reasonably possible.</p>
              <p>9.4 <strong className="text-foreground">Effect of termination.</strong> Upon termination, your right to access and use the Service ceases immediately. We will provide you with a reasonable period (not less than 30 days) to export your Customer Data, after which we may permanently delete it in accordance with our Privacy Policy, subject to any legal retention obligations.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">10) Limitation of liability</h2>
              <p>10.1 <strong className="text-foreground">No indirect damages.</strong> To the maximum extent permitted by applicable law, neither party shall be liable to the other for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, loss of data, business interruption, or cost of substitute services, arising out of or related to these Terms, even if advised of the possibility of such damages.</p>
              <p>10.2 <strong className="text-foreground">Liability cap.</strong> Each party's total aggregate liability arising out of or related to these Terms shall not exceed the total fees paid or payable by you to Cortardo in the 12 months immediately preceding the event giving rise to the claim.</p>
              <p>10.3 <strong className="text-foreground">Exceptions.</strong> Nothing in these Terms limits or excludes liability for: (a) death or personal injury caused by negligence; (b) fraud or fraudulent misrepresentation; (c) breach of confidentiality obligations (Section 8); or (d) any liability that cannot be excluded or limited under applicable law.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">11) Indemnification</h2>
              <p>11.1 You agree to defend, indemnify, and hold harmless Cortardo Technologies Ltd, its affiliates, officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Service in violation of these Terms; (b) your Customer Data; (c) your violation of any applicable law or third-party rights; or (d) any dispute between you and your customers or end users arising from your use of the Service.</p>
              <p>11.2 Cortardo agrees to defend, indemnify, and hold you harmless from any third-party claim that the Service (as provided) infringes any UK or EU intellectual property right, subject to you providing prompt written notice, sole control of the defence, and reasonable cooperation.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">12) Disclaimer of warranties</h2>
              <p>12.1 The Service is provided "as is" and "as available" without any warranties of any kind, whether express, implied, or statutory. To the maximum extent permitted by law, Cortardo disclaims all implied warranties, including merchantability, fitness for a particular purpose, title, and non-infringement.</p>
              <p>12.2 Cortardo does not warrant that: (a) the Service will be uninterrupted, timely, secure, or error-free; (b) defects will be corrected; (c) the Service is free of viruses or other harmful components; or (d) the results obtained from using the Service will meet your requirements.</p>
              <p>12.3 As a code review platform, the Service may use AI to generate review findings and fix suggestions. AI-generated content may contain errors, inaccuracies, or inappropriate outputs. You are solely responsible for reviewing, editing, and approving all code changes merged through your repositories. AI-generated findings do not constitute legal, security-audit, or professional advice.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">13) Force majeure</h2>
              <p>Neither party shall be liable for delays or failures in performance resulting from causes beyond its reasonable control, including acts of God, natural disasters, war, terrorism, riots, embargoes, acts of civil or military authorities, fire, floods, accidents, pandemics, strikes, shortages of transportation or supplies, or failures of third-party networks or utilities.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">14) Changes to these Terms</h2>
              <p>14.1 We may update these Terms from time to time. If we make material changes, we will notify you by email (to the address associated with your account) or through an in-app notification at least 30 days before the changes take effect.</p>
              <p>14.2 Your continued use of the Service after the effective date of the updated Terms constitutes your acceptance of the changes. If you do not agree to the updated Terms, you may cancel your account before the effective date.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">15) Governing law and dispute resolution</h2>
              <p>15.1 <strong className="text-foreground">Governing law.</strong> These Terms and any dispute or claim arising out of or in connection with them (including non-contractual disputes) are governed by the laws of England and Wales.</p>
              <p>15.2 <strong className="text-foreground">Informal resolution.</strong> Before commencing any legal proceedings, the parties agree to attempt to resolve the dispute informally by contacting hello@cortardo.com. Both parties will cooperate in good faith to resolve the matter within 30 days.</p>
              <p>15.3 <strong className="text-foreground">Jurisdiction.</strong> If the dispute cannot be resolved informally, the parties irrevocably submit to the exclusive jurisdiction of the courts of England and Wales. However, either party may seek injunctive or other equitable relief in any court of competent jurisdiction to protect its intellectual property or confidential information.</p>
              <p>15.4 <strong className="text-foreground">Consumer rights.</strong> If you are a consumer (not a business), nothing in this section deprives you of the protection of mandatory consumer protection laws in your country of residence, and any disputes may be resolved in the courts of your country of residence.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">16) Entire agreement</h2>
              <p>These Terms, together with our Privacy Policy and Data Processing Addendum, constitute the entire agreement between you and Cortardo regarding your use of the Service and supersede all prior agreements and understandings. If any provision of these Terms is held to be invalid or unenforceable, the remaining provisions will continue in full force and effect.</p>

              <h2 className="text-base font-semibold text-foreground pt-4">17) Contact</h2>
              <p>Questions, complaints, and notices under these Terms should be sent to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="text-foreground">General enquiries:</strong> hello@cortardo.com</li>
                <li><strong className="text-foreground">Legal notices:</strong> legal@cortardo.com</li>
                <li><strong className="text-foreground">DPA requests:</strong> privacy@cortardo.com</li>
                <li><strong className="text-foreground">Security reports:</strong> security@cortardo.com</li>
                <li><strong className="text-foreground">Post:</strong> Available upon request</li>
              </ul>

            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
