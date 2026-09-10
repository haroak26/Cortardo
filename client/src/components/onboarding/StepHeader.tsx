type Props = {
  title: string;
  subtitle?: string;
};

export function StepHeader({ title, subtitle }: Props) {
  return (
    <div className="space-y-1 mb-6">
      <h1
        className="text-[22px] text-foreground"
        style={{ fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.2 }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          className="text-[13px]"
          style={{ color: "hsl(var(--fg-muted))", fontWeight: 500 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}