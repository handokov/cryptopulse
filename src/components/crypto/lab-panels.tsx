"use client";

import { useCryptoStore } from "@/store/crypto-store";
import { usePulse } from "@/hooks/use-pulse";
import { SignalPolygon } from "./signal-polygon";
import { ProjectionLab } from "./projection-lab";
import { Hexagon, FunctionSquare } from "lucide-react";

/**
 * Two-column lab layout. Both panels flash-pulse when the selected asset
 * changes (global pulse token), wiring the market grid to the labs.
 */
export function LabPanels() {
  const selected = useCryptoStore((s) => s.selected);
  const dataSource = useCryptoStore((s) => s.dataSource);
  const pulse = usePulse(1000);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div
        className={`rounded-2xl border bg-card/50 p-4 transition-colors sm:p-6 ${
          pulse ? "flash-pulse" : "border-border"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Hexagon className="h-4 w-4 text-primary" />
            Signal Polygon
            <span className="rounded-md bg-primary/12 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">{selected}</span>
          </h3>
          <span className="text-[10px] text-muted-foreground">weights → analysis</span>
        </div>
        <SignalPolygon />
      </div>

      <div
        className={`rounded-2xl border bg-card/50 p-4 transition-colors sm:p-6 ${
          pulse ? "flash-pulse" : "border-border"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FunctionSquare className="h-4 w-4 text-accent" />
            Projection Lab
            <span className="rounded-md bg-accent/12 px-2 py-0.5 font-mono text-[10px] font-bold text-accent">{selected}</span>
          </h3>
          {dataSource && (
            <span className="text-[10px] text-muted-foreground">
              {dataSource === "coingecko" ? "coinGecko live · 2m cache" : "internal model · 2m cache"}
            </span>
          )}
        </div>
        <ProjectionLab />
      </div>
    </div>
  );
}
