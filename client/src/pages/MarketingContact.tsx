import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/button";
import { HeroWave } from "@/components/HeroWave";
import { TextInput, Textarea } from "@/components/text-input";
import { Send, CheckCircle2, AlertCircle, Mail, Clock, MessageSquare } from "lucide-react";
import { LandingHero } from "@/components/marketing";
import { MarketingSection } from "@/components/ds/widgets";

const contactMethods = [
  {
    icon: Mail,
    label: "Email us",
    value: "hello@cortardo.com",
    href: "mailto:hello@cortardo.com",
  },
  {
    icon: Clock,
    label: "Response time",
    value: "Within 24 hours",
  },
  {
    icon: MessageSquare,
    label: "Live chat",
    value: "Available 9 AM – 6 PM EST",
  },
];

export default function MarketingContact() {
  const [formData, setFormData] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = "Name is required";
    if (!formData.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = "Please enter a valid email address";
    if (!formData.subject.trim()) errs.subject = "Subject is required";
    if (!formData.message.trim()) errs.message = "Message is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to send" }));
        throw new Error(err.message);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) setFieldErrors(prev => ({ ...prev, [field]: "" }));
  };

  if (submitted) {
    return (
      <Layout fullWidth>
        <LandingHero
          title="Thanks for reaching out!"
          description="We've received your message and will get back to you within 24 hours. If your inquiry is urgent, reach us directly at hello@cortardo.com."
        />
        <MarketingSection>
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-5">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
          </div>
        </MarketingSection>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <LandingHero
        eyebrowLabel="Contact"
        title="Get in touch."
        description="Have a question about Cortardo, need help with your account, or want to share feedback? Send us a message and we'll follow up promptly."
      />

      <MarketingSection>
        <div className="grid md:grid-cols-5 gap-12 md:gap-16">
          <div className="md:col-span-3">
            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="text-[13px] font-medium text-foreground mb-1.5 block">
                      Name <span className="text-destructive">*</span>
                    </label>
                    <TextInput
                      type="text"
                      value={formData.name}
                      onChange={e => handleChange("name", e.target.value)}
                      placeholder="Your name"
                      className={`w-full ${fieldErrors.name ? 'border-destructive' : ''}`}
                    />
                    {fieldErrors.name && <p className="mt-1 text-[11px] text-destructive">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label className="text-[13px] font-medium text-foreground mb-1.5 block">
                      Email <span className="text-destructive">*</span>
                    </label>
                    <TextInput
                      type="email"
                      value={formData.email}
                      onChange={e => handleChange("email", e.target.value)}
                      placeholder="you@example.com"
                      className={`w-full ${fieldErrors.email ? 'border-destructive' : ''}`}
                    />
                    {fieldErrors.email && <p className="mt-1 text-[11px] text-destructive">{fieldErrors.email}</p>}
                  </div>
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground mb-1.5 block">
                    Subject <span className="text-destructive">*</span>
                  </label>
                  <TextInput
                    type="text"
                    value={formData.subject}
                    onChange={e => handleChange("subject", e.target.value)}
                    placeholder="How can we help?"
                    className={`w-full ${fieldErrors.subject ? 'border-destructive' : ''}`}
                  />
                  {fieldErrors.subject && <p className="mt-1 text-[11px] text-destructive">{fieldErrors.subject}</p>}
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground mb-1.5 block">
                    Message <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    value={formData.message}
                    onChange={e => handleChange("message", e.target.value)}
                    placeholder="Tell us more about your question or feedback..."
                    className={`w-full min-h-[140px] ${fieldErrors.message ? 'border-destructive' : ''}`}
                  />
                  {fieldErrors.message && <p className="mt-1 text-[11px] text-destructive">{fieldErrors.message}</p>}
                </div>
                {error && (
                  <div className="flex items-start gap-2.5 px-4 py-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                    <AlertCircle size={14} strokeWidth={1.5} className="shrink-0 mt-0.5 text-destructive" />
                    <span className="text-[13px] text-destructive">{error}</span>
                  </div>
                )}
                <div className="pt-4 border-t border-border">
                  <Button type="submit" isLoading={loading}>
                    <Send size={15} strokeWidth={2} />
                    Send Message
                  </Button>
                </div>
              </div>
            </form>
          </div>

          <div className="md:col-span-2">
            <div className="space-y-6">
              <h3 className="text-[15px] font-semibold text-foreground tracking-[-0.01em]">
                Other ways to reach us
              </h3>
              <div className="space-y-4">
                {contactMethods.map(({ icon: Icon, label, value, href }) => (
                  <div key={label} className="flex gap-3">
                    <div className="shrink-0 mt-0.5">
                      <Icon className="h-[18px] w-[18px] text-brand" />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
                      {href ? (
                        <a href={href} className="text-[14px] font-semibold text-foreground hover:text-brand transition-colors">
                          {value}
                        </a>
                      ) : (
                        <p className="text-[14px] font-semibold text-foreground">{value}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="text-[15px] font-semibold text-foreground tracking-[-0.01em] mb-3">
                  Security & privacy
                </h3>
                <p className="text-[13px] text-fg-muted font-medium leading-relaxed">
                  For security concerns or privacy-related requests, please email us directly at{' '}
                  <a href="mailto:security@cortardo.com" className="text-brand hover:underline font-semibold">
                    security@cortardo.com
                  </a>
                  . For all other privacy questions, see our{' '}
                  <a href="/privacy" className="text-brand hover:underline font-semibold">Privacy Policy</a>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </MarketingSection>

      {/* ── Wave divider into the footer ── */}
      <section className="relative w-full overflow-hidden">
        <HeroWave variant="contact" className="h-[110px] md:h-[150px]" />
      </section>
    </Layout>
  );
}
