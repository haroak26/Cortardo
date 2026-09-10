import { CheckCircle2, XCircle } from "lucide-react";

type Props = {
  password: string;
};

export function PasswordStrength({ password }: Props) {
  if (!password) return null;

  const checks = [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "Contains a number", ok: /\d/.test(password) },
    { label: "Contains uppercase", ok: /[A-Z]/.test(password) },
    { label: "Contains special character", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const colors = ["bg-destructive", "bg-orange-400", "bg-amber-400", "bg-emerald-500", "bg-emerald-600"];

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-colors ${
              i < score ? colors[score] : "bg-border"
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-1">
            {c.ok ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
            ) : (
              <XCircle className="h-2.5 w-2.5 text-fg-faint shrink-0" />
            )}
            <span className={`text-[11px] ${c.ok ? "text-foreground" : "text-fg-muted"}`}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
