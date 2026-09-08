/** Bahasa Indonesia catalog. Keys mirror en.ts exactly. */

import type { Messages } from "./en";

const id: Messages = {
  nav: {
    markets: "Pasar",
    news: "Berita",
    labs: "Lab Sinyal",
    analysis: "Analisis",
    language: "Bahasa",
  },

  hero: {
    badge: "Pasar tak pernah tidur — kami juga",
    tagline: "intelijen pasar, tervisualisasi",
    subtitle:
      "Pelacakan tren harian untuk aset kripto bervolume tertinggi, dikumpulkan dari sumber berita tepercaya. Tarik simpul sinyal, atur fungsi proyeksi dengan slider, dan saksikan analisis prospektif terurai langkah demi langkah.",
    ctaMarket: "Lacak pasar",
    ctaAnalysis: "Jalankan analisis prospektif",
  },

  markets: {
    index: "01 / PASAR",
    title: "Pelacakan tren harian — aset bervolume tinggi",
    subtitle:
      "Cuplikan langsung aset kripto dengan likuiditas tertinggi. Sparkline menampilkan 30 sesi terakhir; klik kartu mana pun untuk memfokuskan seluruh lab dan mesin analisis pada aset tersebut.",
    vol: "Vol {value}",
    mcap: "Kap. Pasar {value}",
    tracking: "DILACAK",
    selectAria: "Pilih {name} untuk analisis",
  },

  labs: {
    index: "02 / LAB SINYAL",
    title: "Bentuk sinyalnya, lalu tekuk kurvanya",
    subtitle:
      "Signal Polygon mengubah bobot faktor menjadi geometri — tarik simpulnya dan lihat nilainya terbaca secara real-time. Projection Lab mengubah asumsi tersebut menjadi fungsi harga berbasis slider dengan pita kepercayaan.",
    polygonTitle: "Signal Polygon",
    projectionTitle: "Projection Lab",
    weightsTo: "bobot → analisis",
    sourceLive: "CoinGecko langsung · cache 2 mnt",
    sourceModel: "model internal · cache 2 mnt",
  },

  factors: {
    momentum: { label: "Momentum", hint: "Rezim RSI / rate-of-change" },
    trend: { label: "Tren", hint: "Struktur moving-average" },
    volume: { label: "Volume", hint: "Partisipasi & arus dana" },
    volatility: { label: "Volatilitas", hint: "Selubung risiko riil" },
    sentiment: { label: "Sentimen", hint: "Nada berita & narasi" },
    liquidity: { label: "Likuiditas", hint: "Kedalaman & spread" },
  },

  polygon: {
    aria: "Poligon faktor yang bisa ditarik — tarik simpul untuk mengatur bobot faktor",
    dragHint: "Tarik simpul mana pun — nilai terbaca secara real-time",
    composite: "Komposit langsung",
    compositeHint:
      "Mencampur bobot simpul Anda dengan sinyal indikator langsung untuk {symbol}. Bobot mengalir langsung ke analisis prospektif di bawah.",
    autoTune: "Otomatis sesuaikan dari pasar",
    resetAria: "Reset faktor ke 50",
  },

  projection: {
    loading: "Memuat model proyeksi…",
    horizon: { label: "Horizon", hint: "Jendela proyeksi" },
    drift: { label: "Bias drift μ̂", hint: "Miringkan tren" },
    vol: { label: "Volatilitas ×", hint: "Lebar pita kepercayaan" },
    waveAmp: { label: "Amplitudo gelombang A", hint: "Ukuran ayunan siklikal" },
    wavePeriod: { label: "Periode gelombang T", hint: "Panjang siklus" },
    daysShort: "h",
    perDayShort: "/h",
    projectedAt: "Proyeksi @ {days}{daysShort}",
    expectedMove: "Pergerakan ekspektasi",
    driftPerDay: "Drift μ̂ / hari",
    annVol: "σ terannualisasi",
    today: "hari ini",
    now: "kini {price}",
  },

  analysis: {
    index: "03 / ANALISIS PROSPEKTIF",
    title: "Putaran perdagangan bertahap, baris demi baris",
    subtitle:
      "Satu kali eksekusi menghitung bias SMA, RSI, MACD, selubung Bollinger, volatilitas riil, partisipasi volume, dan campuran simpul Anda — setiap langkah tersaji baris demi baris dengan kode warna.",
    run: "Jalankan analisis prospektif",
    analyzing: "Menganalisis…",
    placeholderBefore: "Tekan",
    placeholderAfter: "untuk mengurai solusinya baris demi baris.",
    computing: "mengambil deret {symbol}, mencampur {count} simpul kustom…",
    emptyVerdict:
      "Putaran, tingkat keyakinan, dan zona target akan muncul di sini setelah eksekusi baris demi baris selesai.",
    verdict: "Putaran",
    compositeScore: "Skor komposit",
    confidence: "Keyakinan ≈ {value}%",
    modelExpects:
      "Model memperkirakan {price} dalam {days}{daysShort} ({change}). Verifikasi dengan feed berita sebelum bertindak.",
    inputs:
      "Input saat ini — {symbol}, horizon {days}{daysShort}, simpul: {vertices}. Sesuaikan Signal Polygon di atas dan jalankan ulang untuk membandingkan skenario.",
    targets: {
      entry: "Entri",
      support: "Support",
      resistance: "Resist.",
      stop: "Stop",
      t1: "Tgt 1",
      t2: "Tgt 2",
    },
    actions: { long: "LONG", short: "SHORT", neutral: "NETRAL" },
    sourceLive: "CoinGecko langsung",
    sourceModel: "model internal",
    directions: { above: "di atas", below: "di bawah" },
    moods: { constructive: "konstruktif", defensive: "defensif" },
    rsi: {
      overbought: "overbought",
      oversold: "oversold",
      neutral: "zona netral",
      noteOverbought: "Kenaikan yang terlalu sempit meningkatkan peluang koreksi.",
      noteOversold: "Level kapitulasi sering mendahului pantulan mean-reversion.",
      noteNeutral: "Momentum masih punya ruang untuk meluas ke dua arah.",
    },
    regimes: { bullish: "rezim cross bullish", bearish: "rezim cross bearish" },
    bb: {
      strong: "menunggangi pita atas, tren kuat namun stretched",
      weak: "menempel di pita bawah, tren lemah atau sudah basi",
      inside: "di dalam selubung",
    },
    volume: {
      expanding: "partisipasi melebar, pergerakan punya keyakinan",
      cooling: "likuiditas mendingin, breakout kurang andal",
    },
    percentile: {
      upper: "kuartil atas: risiko mengejar naik meningkat",
      lower: "kuartil bawah: kandidat zona akumulasi",
      mid: "rentang tengah: trend-following lebih disarankan daripada fade trade",
    },
    steps: {
      s1Title: "Muat deret model",
      s1Detail: "Termuat {count} harga penutupan harian berakhir di {price} (sumber: {source}).",
      s2Title: "Basis tren — bias SMA",
      s2Detail:
        "SMA₅₀ = {sma50}, SMA₂₀ = {sma20}. Harga berada {bias} {direction} rata-rata 50 hari → konteks tren {mood}.",
      s3Title: "Momentum — RSI(14)",
      s3Detail: "RSI(14) = {rsi} → {zone}. {note}",
      s4Title: "Aliran tren — MACD(12,26,9)",
      s4Detail: "MACD = {macd}, signal = {signal}, histogram = {hist} → {regime}.",
      s4NoData: "Data tidak cukup untuk MACD.",
      s5Title: "Selubung volatilitas — Bollinger(20,2σ)",
      s5Detail:
        "Atas {upper} / bawah {lower}. Harga di posisi {position}% selubung (bandwidth {bandwidth}%) → {note}.",
      s5NoData: "Data tidak cukup untuk Bollinger bands.",
      s6Title: "Pengukur risiko — volatilitas riil",
      s6Detail:
        "σ_harian 30 hari = {daily}% → terannualisasi ≈ {annualized}%. Ukuran posisi sebaiknya berbanding terbalik dengan angka ini.",
      s7Title: "Partisipasi — tren volume",
      s7Detail: "Volume 24 jam {volume} ≈ {trend} vs rata-rata 30 hari → {note}.",
      s8Title: "Campuran faktor — komposit berbobot",
      s8Detail:
        "Aksis indikator: momentum {momentum}, tren {trend}, volatilitas {volatility}. Bobot simpul Anda tercampur menjadi skor komposit {score}/100.",
      s9Title: "Konteks — persentil harga 90 hari",
      s9Detail: "Harga kini berada di persentil {rank} dari rentang 90 hari — {note}.",
      s10Title: "Proyeksi prospektif",
      s10Detail:
        "Dalam {days}{daysShort} dengan drift terskala skor μ̂ = {drift}{perDayShort} → perkiraan harga ≈ {price} ({change}).",
      s11Title: "Putaran",
      s11Detail:
        "Komposit {score}/100 → bias {action} dengan keyakinan {confidence}%. Entri {entry}, stop {stop}, target pertama {target}.",
    },
  },

  news: {
    index: "04 / AGREGASI BERITA",
    title: "Apa yang cetakkan outlet tepercaya hari ini",
    subtitle:
      "Dikumpulkan dari meja redaksi kripto dan pasar mapan (CoinDesk, Cointelegraph, Reuters, Bloomberg, The Block, dan lainnya), dideduplikasi dan diperingkat — sumber tepercaya lebih dulu.",
    feed: "Feed",
    refresh: "Segarkan feed",
    refreshing: "Mengagregasi…",
    trustedOnly: "Hanya sumber tepercaya",
    allSources: "Semua sumber",
    liveVia: "langsung via pencarian web",
    cachedBrief: "ringkasan cache (pencarian tak tersedia)",
    noMatch: "Tidak ada berita yang cocok dengan filter ini. Coba “Semua sumber” atau segarkan.",
  },

  footer: {
    about:
      "CryptoPulse — pelacakan tren harian untuk aset kripto bervolume tinggi. Berita diagregasi dari outlet publik tepercaya.",
    disclaimer:
      "Hanya untuk tujuan informasi. Bukan nasihat keuangan — model bisa salah, pasar bisa lebih aneh. Kelola risiko Anda.",
  },
};

export default id;
