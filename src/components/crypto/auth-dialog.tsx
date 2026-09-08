"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore, type AuthUser } from "@/store/auth-store";

type AuthMode = "login" | "register";

type AuthErrorKey = "errInvalid" | "errEmailTaken" | "errValidation" | "errGeneric";

function mapErrorKey(code: string | undefined): AuthErrorKey {
  switch (code) {
    case "invalid":
      return "errInvalid";
    case "email_taken":
      return "errEmailTaken";
    case "validation":
      return "errValidation";
    default:
      return "errGeneric";
  }
}

/* ---------------- AuthButton (header trigger) ---------------- */

export function AuthButton() {
  const t = useTranslations("auth");
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === "loading") {
    return <Skeleton className="h-8 w-10 rounded-full sm:w-20" />;
  }

  if (status === "unauthenticated" || !user) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDialogOpen(true)}
        aria-label={t("signIn")}
        title={t("signIn")}
        className="gap-1.5 border-primary/30 bg-primary/10 px-2.5 text-xs text-primary hover:bg-primary/20"
      >
        <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        {/* label hidden on phones so the header row (bell + install + auth + language) fits 390px */}
        <span className="hidden sm:inline">{t("signIn")}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={user.name || user.email.split("@")[0]} className="max-w-[170px] gap-1.5 px-2 text-xs">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <UserRound className="h-3 w-3" aria-hidden="true" />
          </span>
          <span className="max-w-[120px] truncate hidden sm:inline">{user.name || user.email.split("@")[0]}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()} className="gap-2 text-xs">
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------- AuthDialog (sign in / register) ---------------- */

export function AuthDialog() {
  const t = useTranslations("auth");
  const dialogOpen = useAuthStore((s) => s.dialogOpen);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);
  const setUser = useAuthStore((s) => s.setUser);

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetFields = () => {
    setEmail("");
    setPassword("");
    setName("");
    setError(null);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    resetFields();
  };

  const switchMode = (m: AuthMode) => {
    setMode(m);
    setError(null);
    setPassword("");
    setName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email: email.trim(), password }
            : { email: email.trim(), password, name: name.trim() || undefined }
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
      if (res.ok && json.user) {
        setUser(json.user);
        closeDialog();
        return;
      }
      setError(json.error ?? "generic");
    } catch {
      setError("generic");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent className="rounded-2xl border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">
            {mode === "login" ? t("loginTitle") : t("registerTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mode === "login" ? t("loginSubtitle") : t("registerSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* mode switcher — segmented control */}
        <div className="grid grid-cols-2 rounded-lg border border-border p-1" role="group">
          <button
            type="button"
            onClick={() => switchMode("login")}
            aria-pressed={mode === "login"}
            className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
              mode === "login" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("loginCta")}
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            aria-pressed={mode === "register"}
            className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
              mode === "register" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("registerCta")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="auth-email"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {t("email")}
            </Label>
            <Input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="h-9 border-border bg-background/60 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="auth-password"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {t("password")}
            </Label>
            <Input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="h-9 border-border bg-background/60 text-sm"
            />
          </div>

          {mode === "register" && (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="auth-name"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("name")}
              </Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("nameOptional")}
                autoComplete="name"
                className="h-9 border-border bg-background/60 text-sm"
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error === "invalid"
                ? t("errInvalid")
                : error === "email_taken"
                  ? t("errEmailTaken")
                  : error === "validation"
                    ? t("errValidation")
                    : t("errGeneric")}
            </div>
          )}

          <Button
            type="submit"
            disabled={pending}
            className="mt-1 h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
          >
            {pending ? t("working") : mode === "login" ? t("loginCta") : t("registerCta")}
          </Button>
        </form>

        <div className="text-center">
          <Button
            variant="link"
            size="sm"
            onClick={() => switchMode(mode === "login" ? "register" : "login")}
            className="h-auto p-0 text-xs text-primary"
          >
            {mode === "login" ? t("toRegister") : t("toLogin")}
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">{t("localOnly")}</p>
      </DialogContent>
    </Dialog>
  );
}
