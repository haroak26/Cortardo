export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="text-sm">Thinking</span>
      <div className="flex gap-1">
        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
        <span className="animate-bounce">.</span>
      </div>
    </div>
  );
}
