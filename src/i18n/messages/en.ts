/**
 * English catalog — source of truth for the message structure.
 * Every other locale file must mirror these keys exactly.
 */

const en = {
  nav: {
    markets: "Markets",
    news: "News",
    labs: "Signal Labs",
    analysis: "Analysis",
    language: "Language",
  },

  hero: {
    badge: "Markets never sleep — neither do we",
    tagline: "market intelligence, visualized",
    subtitle:
      "Daily trend tracking for the highest-volume crypto assets, aggregated with trusted news sources. Drag signal vertices, tune projection functions with sliders, and watch forward-looking analysis unfold step by step.",
    ctaMarket: "Track the market",
    ctaAnalysis: "Run forward analysis",
  },

  markets: {
    index: "01 / MARKETS",
    title: "Daily trend tracking — high-volume assets",
    subtitle:
      "Live snapshot of the highest-liquidity crypto assets. Sparklines show the last 30 sessions; click any card to focus every lab and the analysis engine on that asset.",
    vol: "Vol {value}",
    mcap: "MCap {value}",
    tracking: "TRACKING",
    selectAria: "Select {name} for analysis",
  },

  labs: {
    index: "02 / SIGNAL LABS",
    title: "Shape the signal, then bend the curve",
    subtitle:
      "The Signal Polygon turns factor weights into geometry — drag its vertices and watch values read back in real time. The Projection Lab turns those assumptions into a slider-driven price function with a confidence band.",
    polygonTitle: "Signal Polygon",
    projectionTitle: "Projection Lab",
    weightsTo: "weights → analysis",
    sourceLive: "CoinGecko live · 2m cache",
    sourceModel: "internal model · 2m cache",
  },

  factors: {
    momentum: { label: "Momentum", hint: "RSI / rate-of-change regime" },
    trend: { label: "Trend", hint: "Moving-average structure" },
    volume: { label: "Volume", hint: "Participation & flow" },
    volatility: { label: "Volatility", hint: "Realized risk envelope" },
    sentiment: { label: "Sentiment", hint: "News & narrative tone" },
    liquidity: { label: "Liquidity", hint: "Depth & spreads" },
  },

  polygon: {
    aria: "Draggable factor polygon — drag vertices to adjust factor weights",
    dragHint: "Drag any vertex — values update in real time",
    composite: "Live composite",
    compositeHint:
      "Blends your vertex weights with live indicator signals for {symbol}. Weights flow straight into the forward analysis below.",
    autoTune: "Auto-tune from market",
    resetAria: "Reset factors to 50",
  },

  projection: {
    loading: "Loading projection model…",
    horizon: { label: "Horizon", hint: "Projection window" },
    drift: { label: "Drift bias μ̂", hint: "Tilt the trend" },
    vol: { label: "Volatility ×", hint: "Confidence band width" },
    waveAmp: { label: "Wave amplitude A", hint: "Cyclical swing size" },
    wavePeriod: { label: "Wave period T", hint: "Cycle length" },
    daysShort: "d",
    perDayShort: "/d",
    projectedAt: "Projected @ {days}{daysShort}",
    expectedMove: "Expected move",
    driftPerDay: "Drift μ̂ / day",
    annVol: "Annualized σ",
    today: "today",
    now: "now {price}",
  },

  analysis: {
    index: "03 / FORWARD ANALYSIS",
    title: "Step-by-step trading verdicts, line by line",
    subtitle:
      "One run computes SMA bias, RSI, MACD, Bollinger envelope, realized volatility, volume participation and your vertex blend — each step revealed line by line with a color-coded read.",
    run: "Run forward analysis",
    analyzing: "Analyzing…",
    placeholderBefore: "Press",
    placeholderAfter: "to unfold the solution line by line.",
    computing: "sampling {symbol} series, blending {count} custom vertices…",
    emptyVerdict:
      "Verdict, confidence and target zones appear here once the line-by-line run completes.",
    verdict: "Verdict",
    compositeScore: "Composite score",
    confidence: "Confidence ≈ {value}%",
    modelExpects:
      "Model expects {price} over {days}{daysShort} ({change}). Verify against the news feed before acting.",
    inputs:
      "Current inputs — {symbol}, horizon {days}{daysShort}, vertices: {vertices}. Adjust the Signal Polygon above and re-run to compare scenarios.",
    targets: {
      entry: "Entry",
      support: "Support",
      resistance: "Resist.",
      stop: "Stop",
      t1: "Tgt 1",
      t2: "Tgt 2",
    },
    actions: { long: "LONG", short: "SHORT", neutral: "NEUTRAL" },
    sourceLive: "CoinGecko live",
    sourceModel: "internal model",
    directions: { above: "above", below: "below" },
    moods: { constructive: "constructive", defensive: "defensive" },
    rsi: {
      overbought: "overbought",
      oversold: "oversold",
      neutral: "neutral zone",
      noteOverbought: "Stretched upside raises pullback odds.",
      noteOversold: "Capitulation levels often precede mean-reversion bounces.",
      noteNeutral: "Momentum has room to extend in either direction.",
    },
    regimes: { bullish: "bullish cross regime", bearish: "bearish cross regime" },
    bb: {
      strong: "riding the upper band, trend-strong but extended",
      weak: "hugging the lower band, trend-weak or washed out",
      inside: "inside the envelope",
    },
    volume: {
      expanding: "participation expanding, moves carry conviction",
      cooling: "liquidity cooling, breakouts less reliable",
    },
    percentile: {
      upper: "upper quartile: chase risk elevated",
      lower: "lower quartile: accumulation zone candidates",
      mid: "mid-range: trend-following preferred over fade trades",
    },
    steps: {
      s1Title: "Load model series",
      s1Detail: "Loaded {count} daily closes ending at {price} (source: {source}).",
      s2Title: "Trend baseline — SMA bias",
      s2Detail:
        "SMA₅₀ = {sma50}, SMA₂₀ = {sma20}. Price sits {bias} {direction} the 50-day mean → {mood} trend context.",
      s3Title: "Momentum — RSI(14)",
      s3Detail: "RSI(14) = {rsi} → {zone}. {note}",
      s4Title: "Trend flow — MACD(12,26,9)",
      s4Detail: "MACD = {macd}, signal = {signal}, histogram = {hist} → {regime}.",
      s4NoData: "Not enough data for MACD.",
      s5Title: "Volatility envelope — Bollinger(20,2σ)",
      s5Detail:
        "Upper {upper} / lower {lower}. Price at {position}% of the envelope (bandwidth {bandwidth}%) → {note}.",
      s5NoData: "Not enough data for Bollinger bands.",
      s6Title: "Risk gauge — realized volatility",
      s6Detail:
        "30-day σ_daily = {daily}% → annualized ≈ {annualized}%. Position sizing should scale inverse to this figure.",
      s7Title: "Participation — volume trend",
      s7Detail: "24h volume {volume} tracks ≈ {trend} vs the 30-day average → {note}.",
      s8Title: "Factor blend — weighted composite",
      s8Detail:
        "Indicator-mapped axes: momentum {momentum}, trend {trend}, volatility {volatility}. Your vertex weights blended to a composite score of {score}/100.",
      s9Title: "Context — 90-day price percentile",
      s9Detail: "Current price sits at percentile {rank} of the 90-day range — {note}.",
      s10Title: "Forward projection",
      s10Detail:
        "Over {days}{daysShort} with score-adjusted drift μ̂ = {drift}{perDayShort} → expected price ≈ {price} ({change}).",
      s11Title: "Verdict",
      s11Detail:
        "Composite {score}/100 → {action} bias with {confidence}% confidence. Entry {entry}, stop {stop}, first target {target}.",
    },
  },

  news: {
    index: "04 / NEWS AGGREGATION",
    title: "What trusted outlets are printing today",
    subtitle:
      "Aggregated from established crypto and market desks (CoinDesk, Cointelegraph, Reuters, Bloomberg, The Block and more), deduplicated and ranked — trusted sources first.",
    feed: "Feed",
    refresh: "Refresh feed",
    refreshing: "Aggregating…",
    trustedOnly: "Trusted sources only",
    allSources: "All sources",
    liveVia: "live via web search",
    cachedBrief: "cached brief (search unavailable)",
    noMatch: "No stories matched the current filter. Try “All sources” or refresh.",
  },

  footer: {
    about:
      "CryptoPulse — daily trend tracking for high-volume crypto assets. News aggregated from trusted public outlets.",
    disclaimer:
      "For informational purposes only. Nothing here is financial advice — models can be wrong, markets can be weirder. Manage your risk.",
  },
};

export default en;
export type Messages = typeof en;
