import { Button } from "@/components/button";

export function FAB({ onClick, children, className }: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      design="primary"
      size="sm"
      onClick={onClick}
      className={`fixed right-4 z-40 ${className ?? ""}`}
      style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      {children}
    </Button>
  );
}
