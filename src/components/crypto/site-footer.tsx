export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-xs text-muted-foreground sm:flex-row">
        <p>
          <span className="font-semibold text-foreground/80">CryptoPulse</span> — daily trend
          tracking for high-volume crypto assets. News aggregated from trusted public outlets.
        </p>
        <p className="max-w-md text-center sm:text-right">
          For informational purposes only. Nothing here is financial advice — models can be
          wrong, markets can be weirder. Manage your risk.
        </p>
      </div>
    </footer>
  );
}
