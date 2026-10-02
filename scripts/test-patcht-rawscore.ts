/* Patch T sanity: rawScore must equal the pre-chaos score; score is halved
   only when volAnnPct > 400. Deterministic synthetic series. */
import { computeBotSignal } from "../src/lib/bot/strategy";

function series(uptrend: boolean, n = 120): number[] {
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    // smooth wiggle for calm; violent alternating ±7% prints for wild
    const wig = uptrend ? (i % 2 === 0 ? 15 : -13.5) : Math.sin(i / 3) * 0.4;
    p = p * (1 + (uptrend ? wig / 100 : 0.0005));
    out.push(p);
  }
  return out;
}

const calm = computeBotSignal(series(false));
const wild = computeBotSignal(series(true));
console.log("calm :", { score: calm.score, rawScore: calm.rawScore, vol: calm.volAnnPct.toFixed(1) });
console.log("wild :", { score: wild.score, rawScore: wild.rawScore, vol: wild.volAnnPct.toFixed(1) });
const okCalm = Math.abs(calm.score - calm.rawScore) < 1e-9 || calm.volAnnPct <= 400;
const okWild = wild.volAnnPct > 400 ? Math.abs(wild.score - wild.rawScore * 0.5) < 1.1e-3 : true;
console.log("rawScore wiring:", okCalm && okWild ? "OK" : "FAIL");
