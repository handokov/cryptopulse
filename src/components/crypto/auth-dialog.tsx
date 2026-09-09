"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, LogIn, LogOut, MailCheck, UserRound } from "lucide-react";
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
import { PasswordInput } from "@/components/crypto/password-input";

type AuthMode = "login" | "register" | "forgot" | "reset";

type AuthErrorKey =
  | "errInvalid"
  | "errEmailTaken"
  | "errValidation"
  | "errGeneric"
  | "errTokenInvalid"
  | "errRateLimited";

function mapErrorKey(code: string | undefined): AuthErrorKey {
  switch (code) {
    case "invalid":
      return "errInvalid";
    case "email_taken":
      return "errEmailTaken";
    case "validation":
      return "errValidation";
    case "invalid_token":
      return "errTokenInvalid";
    case "rate_limited":
      return "errRateLimited";
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

/* ---------------- AuthDialog (sign in / register / forgot / reset) ---------------- */

const TITLES: Record<AuthMode, { title: string; subtitle: string }> = {
  login: { title: "loginTitle", subtitle: "loginSubtitle" },
  register: { title: "registerTitle", subtitle: "registerSubtitle" },
  forgot: { title: "forgotTitle", subtitle: "forgotSubtitle" },
  reset: { title: "resetTitle", subtitle: "resetSubtitle" },
};

export function AuthDialog() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const dialogOpen = useAuthStore((s) => s.dialogOpen);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);
  const setUser = useAuthStore((s) => s.setUser);

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [forgotDone, setForgotDone] = useState(false);
  const [forgotInfo, setForgotInfo] = useState<{ emailSent: boolean; devUrl: string | null } | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetFields = () => {
    setEmail("");
    setPassword("");
    setConfirm("");
    setName("");
    setError(null);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    resetFields();
    setMode("login");
    setResetToken(null);
    setForgotDone(false);
    setForgotInfo(null);
    setResetDone(false);
  };

  const switchMode = (m: AuthMode) => {
    setMode(m);
    setError(null);
    setPassword("");
    setConfirm("");
    setName("");
    if (m === "login" || m === "register") {
      setResetToken(null);
      setForgotDone(false);
      setForgotInfo(null);
      setResetDone(false);
    }
  };

  // Deep link from the reset email: /?reset=<token> opens the dialog
  // directly in reset mode, then the token is scrubbed from the URL bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (token) {
      params.delete("reset");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      setResetToken(token);
      setMode("reset");
      setDialogOpen(true);
    }
  }, [setDialogOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), locale }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          emailSent?: boolean;
          devUrl?: string | null;
          error?: string;
        };
        if (res.ok && json.ok) {
          setForgotInfo({ emailSent: Boolean(json.emailSent), devUrl: json.devUrl ?? null });
          setForgotDone(true);
        } else {
          setError(json.error ?? "generic");
        }
        return;
      }

      if (mode === "reset") {
        if (password !== confirm) {
          setError("mismatch");
          return;
        }
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: resetToken, password }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && json.ok) {
          setResetDone(true);
        } else {
          setError(json.error ?? "generic");
        }
        return;
      }

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

  const headerCopy = TITLES[mode];
  const isAccountMode = mode === "login" || mode === "register";

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
            {t(headerCopy.title)}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t(headerCopy.subtitle)}
          </DialogDescription>
        </DialogHeader>

        {/* mode switcher — segmented control (account modes only) */}
        {isAccountMode && (
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
        )}

        {mode === "login" && (
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
              <PasswordInput
                id="auth-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {/* forgot password shortcut — login mode only */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  {t("forgotPassword")}
                </button>
              </div>
            </div>

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
                      : error === "invalid_token"
                        ? t("errTokenInvalid")
                        : error === "rate_limited"
                          ? t("errRateLimited")
                          : t("errGeneric")}
              </div>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="mt-1 h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {pending ? t("working") : t("loginCta")}
            </Button>
          </form>
        )}

        {mode === "register" && (
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
              <PasswordInput
                id="auth-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

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
                      : error === "invalid_token"
                        ? t("errTokenInvalid")
                        : error === "rate_limited"
                          ? t("errRateLimited")
                          : t("errGeneric")}
              </div>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="mt-1 h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {pending ? t("working") : t("registerCta")}
            </Button>
          </form>
        )}

        {mode === "forgot" && !forgotDone && (
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

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error === "validation"
                  ? t("errValidation")
                  : error === "rate_limited"
                    ? t("errRateLimited")
                    : t("errGeneric")}
              </div>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="mt-1 h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {pending ? t("working") : t("forgotCta")}
            </Button>
          </form>
        )}

        {mode === "forgot" && forgotDone && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-foreground/90">{t("forgotSent")}</p>
            </div>

            {forgotInfo?.devUrl && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-[11px] leading-relaxed text-amber-500">{t("forgotDevNote")}</p>
                <a
                  href={forgotInfo.devUrl}
                  className="mt-2 block truncate rounded-md bg-amber-500/15 px-2 py-1.5 text-[11px] text-amber-400 underline-offset-2 hover:underline"
                >
                  {t("openReset")}
                </a>
              </div>
            )}

            {!forgotInfo?.devUrl && !forgotInfo?.emailSent && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-[11px] leading-relaxed text-amber-500">{t("emailNotConfiguredNote")}</p>
              </div>
            )}
          </div>
        )}

        {mode === "reset" && !resetDone && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="auth-new-password"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("newPassword")}
              </Label>
              <PasswordInput
                id="auth-new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="auth-confirm-password"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("confirmPassword")}
              </Label>
              <PasswordInput
                id="auth-confirm-password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error === "mismatch"
                  ? t("errMismatch")
                  : error === "validation"
                    ? t("errValidation")
                    : error === "invalid_token"
                      ? t("errTokenInvalid")
                      : error === "rate_limited"
                        ? t("errRateLimited")
                        : t("errGeneric")}
              </div>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="mt-1 h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {pending ? t("working") : t("resetCta")}
            </Button>
          </form>
        )}

        {mode === "reset" && resetDone && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-foreground/90">{t("resetSuccess")}</p>
            </div>
            <Button
              type="button"
              onClick={() => switchMode("login")}
              className="h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {t("loginCta")}
            </Button>
          </div>
        )}

        <div className="text-center">
          {isAccountMode ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
              className="h-auto p-0 text-xs text-primary"
            >
              {mode === "login" ? t("toRegister") : t("toLogin")}
            </Button>
          ) : (
            <Button
              variant="link"
              size="sm"
              onClick={() => switchMode("login")}
              className="h-auto p-0 text-xs text-primary"
            >
              {t("backToSignIn")}
            </Button>
          )}
        </div>

        {isAccountMode && <p className="text-center text-[11px] text-muted-foreground">{t("localOnly")}</p>}
      </DialogContent>
    </Dialog>
  );
}
