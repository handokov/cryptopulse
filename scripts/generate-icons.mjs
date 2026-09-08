/**
 * CryptoPulse PWA icon generator.
 * Renders the brand "pulse" mark (emerald heartbeat line + amber endpoint dot
 * on a deep-emerald gradient) into every icon the PWA needs:
 *   - icon-192.png / icon-512.png            (rounded "any" icons)
 *   - maskable-192.png / maskable-512.png    (full-bleed, content in safe zone)
 *   - apple-touch-icon.png (180)             (full-bleed, iOS rounds corners)
 *   - favicon-32.png                         (bold simplified favicon)
 * Run: bun scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const OUT = "public/icons";

/** Pulse line shared by all variants (512 coordinate space). */
const PULSE_PATH = "M76 292 H196 L244 176 L300 372 L348 232 H436";

function svg({
  fullBleed = false,
  glow = true,
  dot = true,
  strokeWidth = 36,
  dotR = 20,
}) {
  const radius = fullBleed ? 0 : 115;
  // maskable safe zone: keep content within the central ~62% of the canvas
  const content = fullBleed
    ? `<g transform="translate(97.28 97.28) scale(0.62)">${pulse(strokeWidth / 0.62, dotR / 0.62, glow)}</g>`
    : `<g>${pulse(strokeWidth, dotR, glow)}</g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#022c22"/>
      <stop offset="0.55" stop-color="#064e3b"/>
      <stop offset="1" stop-color="#065f46"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#10b981" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#10b981" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#halo)"/>
  ${content}
</svg>`;

  function pulse(sw, r, useGlow) {
    return `
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${
        useGlow
          ? `<path d="${PULSE_PATH}" stroke="#34d399" stroke-width="${sw * 1.8}" opacity="0.45" filter="url(#glow)"/>`
          : ""
      }
      <path d="${PULSE_PATH}" stroke="#34d399" stroke-width="${sw}"/>
    </g>
    ${dot ? `<circle cx="436" cy="232" r="${r}" fill="#fbbf24"/>` : ""}`;
  }
}

async function render(name, svgStr, size) {
  await sharp(Buffer.from(svgStr))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${name}`);
  console.log(`✓ ${name} (${size}×${size})`);
}

await mkdir(OUT, { recursive: true });

// "any" icons — rounded square, glow + amber dot
await render("icon-512.png", svg({}), 512);
await render("icon-192.png", svg({}), 192);

// maskable — full-bleed background, content pulled into the safe zone
await render("maskable-512.png", svg({ fullBleed: true }), 512);
await render("maskable-192.png", svg({ fullBleed: true }), 192);

// apple touch icon — full-bleed (iOS applies its own corner mask), 180
await render("apple-touch-icon.png", svg({ fullBleed: true }), 180);

// favicon — bold strokes, no glow, keep the dot
await render("favicon-32.png", svg({ strokeWidth: 56, dotR: 30, glow: false }), 32);

console.log("All icons written to public/icons/");
