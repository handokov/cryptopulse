"use client";

/**
 * Exchange connections card (inside the authenticated portfolio section).
 *
 * Lets the user link Binance / Bitget / Tokocrypto (or the sandbox demo
 * adapter) via READ-ONLY API keys. Credentials are sent once over POST,
 * tested live against the exchange, then stored AES-256-GCM encrypted —
 * they are never returned to the browser again (only a masked form).
 * Each sync mirrors on-exchange balances into auto-synced holdings and
 * removes positions the exchange no longer reports; manual holdings are
 * never touched.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CircleAlert,
  FlaskConical,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/store/auth-store";
import { useLocaleStore } from "@/store/locale-store";
import type { Locale } from "@/i18n/config";
import { fmtPrice } from "@/lib/format";
import type { SyncOutcome } from "@/lib/exchanges/sync";

/* ---------------- types (mirror the API contracts) ---------------- */

interface ConnectionRow {
  id: string;
  exchange: string;
  label: string | null;
  apiKeyMasked: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  assetCount: number;
}

type ErrorCode =
  | "unauthorized"
  | "validation"
  | "network"
  | "auth"
  | "rate_limit"
  | "unexpected"
  | "duplicate"
  | "market"
  | "generic"
  | "not_found";

/* ---------------- static exchange metadata ---------------- */

interface ExchangeMeta {
  id: string;
  name: string;
  avatarClass: string;
  needsCredentials: boolean;
  needsPassphrase: boolean;
}

const EXCHANGES: ExchangeMeta[] = [
  { id: "binance", name: "Binance", avatarClass: "bg-amber-400/15 text-amber-300", needsCredentials: true, needsPassphrase: false },
  { id: "bitget", name: "Bitget", avatarClass: "bg-teal-400/15 text-teal-300", needsCredentials: true, needsPassphrase: true },
  { id: "tokocrypto", name: "Tokocrypto", avatarClass: "bg-primary/15 text-primary", needsCredentials: true, needsPassphrase: false },
  { id: "demo", name: "CryptoPulse Sandbox", avatarClass: "bg-muted text-muted-foreground", needsCredentials: false, needsPassphrase: false },
];

function metaOf(id: string): ExchangeMeta {
  return EXCHANGES.find((e) => e.id === id) ?? EXCHANGES[3];
}

/* ---------------- small helpers ---------------- */

function dateLocale(l: Locale): string {
  switch (l) {
    case "id":
      return "id-ID";
    case "zh":
      return "zh-CN";
    case "es":
      return "es-ES";
    case "pt":
      return "pt-BR";
    case "ja":
      return "ja-JP";
    default:
      return "en-US";
  }
}

function fmtQty(q: number): string {
  if (Math.abs(q) >= 1_000_000)
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(q);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(q);
}

function ActionBadge({ action, label }: { action: string; label: string }) {
  if (action === "unchanged") return null;
  const cls =
    action === "created"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-amber-400/40 bg-amber-400/10 text-amber-300";
  return (
    <span className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

/* ---------------- component ---------------- */

export function ExchangeConnections({ onChanged }: { onChanged: () => void }) {
  const t = useTranslations("exchanges");
  const status = useAuthStore((s) => s.status);
  const locale = useLocaleStore((s) => s.locale);

  /* connection list */
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  /* connect dialog */
  const [connectOpen, setConnectOpen] = useState(false);
  const [exchange, setExchange] = useState("binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<ErrorCode | null>(null);

  /* sync / delete */
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [result, setResult] = useState<SyncOutcome | null>(null);
  const [deleting, setDeleting] = useState<ConnectionRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const meta = metaOf(exchange);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/exchange-connections", { cache: "no-store" });
      if (!res.ok) throw new Error(`connections fetch failed: ${res.status}`);
      const json = (await res.json()) as { connections: ConnectionRow[] };
      setConnections(json.connections ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const resetForm = () => {
    setLabel("");
    setApiKey("");
    setApiSecret("");
    setApiPassphrase("");
    setFormError(null);
  };

  const errText = (code: ErrorCode): string => {
    switch (code) {
      case "unauthorized":
        return t("errUnauthorized");
      case "validation":
        return t("errValidation");
      case "network":
        return t("errNetwork");
      case "auth":
        return t("errAuth");
      case "rate_limit":
        return t("errRateLimit");
      case "duplicate":
        return t("errDuplicate");
      case "market":
        return t("errMarket");
      default:
        return t("errGeneric");
    }
  };

  const handleConnect = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/exchange-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          label: label.trim() || undefined,
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          apiPassphrase: apiPassphrase.trim() || undefined,
        }),
      });

      if (res.status === 201) {
        const json = (await res.json()) as { outcome: SyncOutcome };
        setConnectOpen(false);
        resetForm();
        setResult(json.outcome);
        toast.success(t("connectDone"));
        onChanged();
        void load();
        return;
      }
      if (res.status === 207) {
        // Stored, but the first import failed — keep the dialog open with a hint.
        const json = (await res.json()) as { error?: ErrorCode };
        setFormError(json.error ?? "generic");
        void load();
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: ErrorCode };
      setFormError(json.error ?? "generic");
    } catch {
      setFormError("network");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (conn: ConnectionRow) => {
    if (syncingId) return;
    setSyncingId(conn.id);
    try {
      const res = await fetch(`/api/exchange-connections/${conn.id}/sync`, { method: "POST" });
      if (res.ok) {
        const json = (await res.json()) as { outcome: SyncOutcome };
        setResult(json.outcome);
        toast.success(t("syncDone"));
        onChanged();
        void load();
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: ErrorCode };
        toast.error(errText(json.error ?? "generic"));
        void load();
      }
    } catch {
      toast.error(errText("network"));
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting || deletePending) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/exchange-connections/${deleting.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("deleteDone"));
        onChanged();
        void load();
        setDeleting(null);
      } else {
        toast.error(t("errGeneric"));
      }
    } catch {
      toast.error(t("errNetwork"));
    } finally {
      setDeletePending(false);
    }
  };

  if (status !== "authenticated") return null;

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
      {/* header */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setExchange("binance");
            resetForm();
            setConnectOpen(true);
          }}
          className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/25"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("connect")}
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{t("subtitle")}</p>

      {/* list / empty / error */}
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
            {t("errGeneric")}
          </span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("retry")}
          </Button>
        </div>
      ) : loading ? (
        <div className="h-20 animate-pulse rounded-xl bg-card/60" aria-hidden="true" />
      ) : connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-center">
          <KeyRound className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {connections.map((conn) => {
            const m = metaOf(conn.exchange);
            const isSyncing = syncingId === conn.id;
            const lastSynced = conn.lastSyncAt
              ? new Intl.DateTimeFormat(dateLocale(locale), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(conn.lastSyncAt))
              : t("never");
            return (
              <li
                key={conn.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card/60 p-3"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${m.avatarClass}`}
                  aria-hidden="true"
                >
                  {conn.exchange === "demo" ? (
                    <FlaskConical className="h-4 w-4" />
                  ) : (
                    m.name.slice(0, 1)
                  )}
                </span>

                <div className="min-w-0 flex-1 basis-40">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    {m.name}
                    {conn.label && (
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        · {conn.label}
                      </span>
                    )}
                  </p>
                  <p className="tnum text-[11px] text-muted-foreground">{conn.apiKeyMasked}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${conn.status === "error" ? "bg-destructive" : "bg-primary live-dot"}`}
                    aria-hidden="true"
                  />
                  <div className="leading-tight">
                    <p
                      className={`text-xs font-medium ${conn.status === "error" ? "text-destructive" : "text-foreground"}`}
                      title={conn.lastError ?? undefined}
                    >
                      {conn.status === "error" ? t("statusError") : t("statusActive")}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("assetCount", { count: conn.assetCount })} · {t("lastSynced")}{" "}
                      {lastSynced}
                    </p>
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSyncing || syncingId !== null}
                    onClick={() => void handleSync(conn)}
                    className="gap-1.5 border-primary/30 bg-primary/10 px-2.5 text-primary hover:bg-primary/20"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="hidden sm:inline">
                      {isSyncing ? t("syncing") : t("syncNow")}
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleting(conn)}
                    aria-label={t("delete")}
                    title={t("delete")}
                    className="border-destructive/30 bg-destructive/10 px-2.5 text-destructive hover:bg-destructive/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------------- connect dialog ---------------- */}
      <Dialog
        open={connectOpen}
        onOpenChange={(v) => {
          setConnectOpen(v);
          if (!v) resetForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto nice-scroll sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("connect")}</DialogTitle>
            <DialogDescription>{t("subtitle")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="xc-exchange">{t("exchangeLabel")}</Label>
              <Select
                value={exchange}
                onValueChange={(v) => {
                  setExchange(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger id="xc-exchange" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXCHANGES.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.id === "demo" ? t("demoName") : e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="xc-label">{t("nicknameLabel")}</Label>
              <Input
                id="xc-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("nicknamePlaceholder")}
                autoComplete="off"
              />
            </div>

            {meta.needsCredentials && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xc-key">{t("apiKeyLabel")}</Label>
                  <Input
                    id="xc-key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="tnum"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xc-secret">{t("apiSecretLabel")}</Label>
                  <Input
                    id="xc-secret"
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="tnum"
                  />
                </div>
              </>
            )}

            {meta.needsPassphrase && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="xc-pass">{t("passphraseLabel")}</Label>
                <Input
                  id="xc-pass"
                  type="password"
                  value={apiPassphrase}
                  onChange={(e) => setApiPassphrase(e.target.value)}
                  autoComplete="off"
                  className="tnum"
                />
                <p className="text-[11px] text-muted-foreground">{t("passphraseHint")}</p>
              </div>
            )}

            {/* security note */}
            <div className="flex gap-2.5 rounded-xl border border-primary/25 bg-primary/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">{t("securityBody")}</p>
            </div>

            {/* per-exchange how-to */}
            {meta.needsCredentials && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{t("howToTitle")}: </span>
                {exchange === "binance" && t("howToBinance")}
                {exchange === "bitget" && t("howToBitget")}
                {exchange === "tokocrypto" && t("howToTokocrypto")}
              </p>
            )}

            {formError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {errText(formError)}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConnectOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                onClick={() => void handleConnect()}
                disabled={saving}
                className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/25"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t("connecting")}
                  </>
                ) : (
                  t("connectCta")
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- sync result dialog ---------------- */}
      <Dialog open={result !== null} onOpenChange={(v) => !v && setResult(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto nice-scroll sm:max-w-md">
          {result && (
            <>
              <DialogHeader>
                <DialogTitle>{t("resultTitle")}</DialogTitle>
                <DialogDescription>
                  {metaOf(result.exchange).id === "demo" ? t("demoName") : metaOf(result.exchange).name}
                  {" · "}
                  {new Intl.DateTimeFormat(dateLocale(locale), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(result.syncedAt))}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                {/* stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
                    <p className="tnum text-lg font-bold text-foreground">{fmtPrice(result.totalValueUsd)}</p>
                    <p className="text-[11px] text-muted-foreground">{t("resultTotal")}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
                    <p className="tnum text-lg font-bold text-foreground">{result.matched.length}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("resultAdded", { count: result.added })} · {t("resultUpdated", { count: result.updated })}
                      {result.removedCount > 0 && ` · ${t("resultRemoved", { count: result.removedCount })}`}
                    </p>
                  </div>
                </div>

                {/* matched list */}
                {result.matched.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-foreground">{t("resultMatched")}</p>
                    <ScrollArea className="max-h-56 rounded-xl border border-border">
                      <ul className="divide-y divide-border">
                        {result.matched.map((m) => (
                          <li key={m.coinId} className="flex items-center gap-2.5 p-2.5">
                            {m.image ? (
                              <img src={m.image} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full" />
                            ) : (
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary"
                                aria-hidden="true"
                              >
                                {m.symbol.slice(0, 1)}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                {m.symbol}
                                <span className="truncate text-xs font-normal text-muted-foreground">
                                  {m.name}
                                </span>
                                <ActionBadge
                                  action={m.action}
                                  label={m.action === "created" ? t("badgeAdded") : t("badgeUpdated")}
                                />
                              </p>
                              <p className="tnum text-[11px] text-muted-foreground">
                                {t("qtyLabel", { qty: fmtQty(m.quantity) })}
                              </p>
                            </div>
                            <p className="tnum text-sm text-foreground">
                              {m.valueUsd != null ? fmtPrice(m.valueUsd) : "—"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                {/* unmatched */}
                {result.unmatched.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-foreground">{t("resultUnmatched")}</p>
                    <p className="mb-1.5 text-[11px] text-muted-foreground">{t("resultUnmatchedHint")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.unmatched.map((u) => (
                        <span
                          key={u.asset}
                          className="tnum rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          {u.asset} · {fmtQty(u.quantity)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* removed */}
                {result.removed.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-foreground">{t("resultRemovedTitle")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.removed.map((r) => (
                        <span
                          key={r.symbol}
                          className="tnum rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
                        >
                          {r.symbol} · {fmtQty(r.quantity)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {result.matched.length === 0 && result.unmatched.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t("unchanged")}</p>
                )}

                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("costBasisNote")}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------- delete confirmation ---------------- */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteBody", {
                name: deleting
                  ? `${metaOf(deleting.exchange).id === "demo" ? t("demoName") : metaOf(deleting.exchange).name}${deleting.label ? ` (${deleting.label})` : ""}`
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletePending ? t("deleting") : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
