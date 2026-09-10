import { Eye, EyeOff } from "lucide-react";
import { IconButton, type IconButtonProps } from "@/components/button";

export interface PasswordToggleProps
  extends Omit<IconButtonProps, "icon" | "children" | "aria-label" | "size"> {
  visible: boolean;
  onToggle: () => void;
}

export function PasswordToggle({ visible, onToggle, ...props }: PasswordToggleProps) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <IconButton
      type="button"
      size="xs"
      className="hover:bg-transparent"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      {...props}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  );
}
