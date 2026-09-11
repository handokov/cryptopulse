"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** Visual density — matches the auth dialog inputs by default. */
  className?: string;
}

/**
 * Password field with an eye toggle (show / hide).
 * Keeps every prop of the underlying shadcn Input except `type`,
 * which is managed internally.
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const t = useTranslations("auth");
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={show ? "text" : "password"}
        className={`h-9 border-border bg-background/60 pr-10 text-sm ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? t("hidePassword") : t("showPassword")}
        aria-pressed={show}
        title={show ? t("hidePassword") : t("showPassword")}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {show ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
