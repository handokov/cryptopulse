/* Analisis distribusi volume 24 jam (usdtVolume) seluruh pair spot Bitget.
   Menjawab: berapa banyak koin yang lolos ambang 1M / 3M / 10M, dan di mana
   posisi koin-koin milik user (ARX/UAI/ROBO). */
const data = JSON.parse(require("fs").readFileSync("/home/z/my-project/upload/tickers.json", "utf8"));
const rows = (data.data || []).filter((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT"));
const vols = rows
  .map((r) => ({ sym: r.symbol, vol: Number(r.usdtVolume) || 0 }))
  .sort((a, b) => b.vol - a.vol);

const count = (min) => vols.filter((v) => v.vol >= min).length;
const fmt = (x) =>
  x >= 1e9 ? (x / 1e9).toFixed(2) + "B" : x >= 1e6 ? (x / 1e6).toFixed(2) + "M" : (x / 1e3).toFixed(0) + "K";

console.log("Total pair /USDT:", vols.length);
console.log(">= 100M :", count(100e6));
console.log(">= 10M  :", count(10e6));
console.log(">= 3M   :", count(3e6));
console.log(">= 1M   :", count(1e6));
console.log(">= 500K :", count(500e3));
console.log(">= 250K :", count(250e3));
console.log(">= 100K :", count(100e3));
console.log("< 100K  :", vols.filter((v) => v.vol < 100e3).length);

const rank = (sym) => {
  const i = vols.findIndex((v) => v.sym === sym);
  return i < 0 ? "tidak ada" : `#${i + 1} dari ${vols.length}, vol ${fmt(vols[i].vol)}`;
};
for (const s of ["ARXUSDT", "UAIUSDT", "ROBOUSDT"]) console.log(s.padEnd(9), ":", rank(s));

console.log("\n--- 12 terbesar ---");
vols.slice(0, 12).forEach((v, i) => console.log(String(i + 1).padStart(2), v.sym.padEnd(14), fmt(v.vol)));
console.log("\n--- sekitar ambang 1M (peringkat 41-60) ---");
const idx1m = vols.findIndex((v) => v.vol < 1e6);
console.log("pertama di bawah 1M: peringkat", idx1m + 1);
vols.slice(Math.max(0, idx1m - 10), idx1m + 9).forEach((v, i) => console.log(v.sym.padEnd(14), fmt(v.vol)));
