/** 日本語カタログ。キー構成は en.ts と完全に一致。 */

import type { Messages } from "./en";

const ja: Messages = {
  nav: {
    markets: "マーケット",
    news: "ニュース",
    labs: "シグナルラボ",
    analysis: "分析",
    language: "言語",
  },

  hero: {
    badge: "市場は眠らない ― 私たちも",
    tagline: "マーケット・インテリジェンスを可視化",
    subtitle:
      "出来高の最も大きい暗号資産の毎日のトレンドを、信頼できるニュースソースと併せて追跡。シグナルの頂点をドラッグし、スライダーで投影関数を調整しながら、将来分析が一行ずつ展開するのをご覧ください。",
    ctaMarket: "マーケットを追跡",
    ctaAnalysis: "将来分析を実行",
  },

  markets: {
    index: "01 / マーケット",
    title: "毎日のトレンド追跡 ― 高出来高アセット",
    subtitle:
      "流動性の最も高い暗号資産のライブスナップショット。スパークラインは直近 30 セッションを表示。カードをクリックすると、すべてのラボと分析エンジンがそのアセットにフォーカスされます。",
    vol: "出来高 {value}",
    mcap: "時価総額 {value}",
    tracking: "追跡中",
    selectAria: "{name} を分析対象に選択",
  },

  labs: {
    index: "02 / シグナルラボ",
    title: "シグナルを形作り、そして曲線を曲げる",
    subtitle:
      "シグナルポリゴンは因子の重みを幾何学に変換します ― 頂点をドラッグすると値がリアルタイムに読み戻されます。投影ラボはその仮定を、信頼区間付きのスライダー駆動の価格関数へと変えます。",
    polygonTitle: "シグナルポリゴン",
    projectionTitle: "投影ラボ",
    weightsTo: "重み → 分析",
    sourceLive: "CoinGecko ライブ · 2分キャッシュ",
    sourceModel: "内部モデル · 2分キャッシュ",
  },

  factors: {
    momentum: { label: "モメンタム", hint: "RSI / 変化率レジーム" },
    trend: { label: "トレンド", hint: "移動平均の構造" },
    volume: { label: "出来高", hint: "参加度とフロー" },
    volatility: { label: "ボラティリティ", hint: "実現リスクの包絡線" },
    sentiment: { label: "センチメント", hint: "ニュースとナラティブのトーン" },
    liquidity: { label: "流動性", hint: "板厚とスプレッド" },
  },

  polygon: {
    aria: "ドラッグ可能な因子ポリゴン ― 頂点をドラッグして因子の重みを調整",
    dragHint: "任意の頂点をドラッグ ― 値がリアルタイムで更新されます",
    composite: "ライブ複合スコア",
    compositeHint:
      "あなたの頂点の重みを {symbol} のライブ指標シグナルと融合させます。重みはそのまま下の将来分析へ流れ込みます。",
    autoTune: "市場から自動調整",
    resetAria: "因子を 50 にリセット",
  },

  projection: {
    loading: "投影モデルを読み込み中…",
    horizon: { label: "期間", hint: "投影ウィンドウ" },
    drift: { label: "ドリフト偏向 μ̂", hint: "トレンドを傾ける" },
    vol: { label: "ボラティリティ ×", hint: "信頼区間の幅" },
    waveAmp: { label: "波の振幅 A", hint: "周期的な振れの大きさ" },
    wavePeriod: { label: "波の周期 T", hint: "サイクルの長さ" },
    daysShort: "日",
    perDayShort: "/日",
    projectedAt: "{days}{daysShort}後の予測",
    expectedMove: "期待変動",
    driftPerDay: "ドリフト μ̂ / 日",
    annVol: "年率 σ",
    today: "今日",
    now: "現在 {price}",
  },

  analysis: {
    index: "03 / 将来分析",
    title: "一行ずつ展開する、段階的トレード判定",
    subtitle:
      "1 回の実行で SMA バイアス、RSI、MACD、ボリンジャーバンド、実現ボラティリティ、出来高参加度、そして頂点ブレンドを計算 ― 各ステップが色分け付きで一行ずつ示されます。",
    run: "将来分析を実行",
    analyzing: "分析中…",
    placeholderBefore: "押してください",
    placeholderAfter: "解を一行ずつ展開します。",
    computing: "{symbol} の系列をサンプリングし、{count} 個のカスタム頂点をブレンド中…",
    emptyVerdict: "一行ずつの実行が完了すると、判定・信頼度・目標ゾーンがここに表示されます。",
    verdict: "判定",
    compositeScore: "複合スコア",
    confidence: "信頼度 ≈ {value}%",
    modelExpects:
      "モデルは {days}{daysShort} 後に {price} を想定（{change}）。行動の前にニュースフィードで確認してください。",
    inputs:
      "現在の入力 ― {symbol}、期間 {days}{daysShort}、頂点: {vertices}。上のシグナルポリゴンを調整して再実行すると、シナリオを比較できます。",
    targets: {
      entry: "エントリー",
      support: "サポート",
      resistance: "レジスタンス",
      stop: "ストップ",
      t1: "目標1",
      t2: "目標2",
    },
    actions: { long: "ロング", short: "ショート", neutral: "中立" },
    sourceLive: "CoinGecko ライブ",
    sourceModel: "内部モデル",
    directions: { above: "上", below: "下" },
    moods: { constructive: "前向き", defensive: "防御的" },
    rsi: {
      overbought: "買われすぎ",
      oversold: "売られすぎ",
      neutral: "中立圏",
      noteOverbought: "伸びきった上昇は調整の可能性を高めます。",
      noteOversold: "投げ売り水準は平均回帰の反発を先行することが多い。",
      noteNeutral: "モメンタムはどちらの方向にも伸びる余地があります。",
    },
    regimes: { bullish: "強気クロス体制", bearish: "弱気クロス体制" },
    bb: {
      strong: "上位バンドに乗った強いトレンド、ただし伸びきり気味",
      weak: "下位バンドに張り付く弱いトレンド、あるいは売り尽くし",
      inside: "バンド内部に収まる",
    },
    volume: {
      expanding: "参加が拡大中、値動きに確信が伴う",
      cooling: "流動性が冷め、ブレイクアウトの信頼性は低下",
    },
    percentile: {
      upper: "上位四分位: 追いかけ買いのリスクが高まる",
      lower: "下位四分位: 仕込みゾーンの候補",
      mid: "中間域: 逆張りより順張りが有利",
    },
    steps: {
      s1Title: "モデル系列の読み込み",
      s1Detail: "直近 {count} 分の終値（終点 {price}）を読み込みました（ソース: {source}）。",
      s2Title: "トレンド基準 ― SMA バイアス",
      s2Detail:
        "SMA₅₀ = {sma50}、SMA₂₀ = {sma20}。価格は 50 日平均の {direction} に {bias} → トレンド環境は{mood}。",
      s3Title: "モメンタム ― RSI(14)",
      s3Detail: "RSI(14) = {rsi} → {zone}。{note}",
      s4Title: "トレンドフロー ― MACD(12,26,9)",
      s4Detail: "MACD = {macd}、シグナル = {signal}、ヒストグラム = {hist} → {regime}。",
      s4NoData: "MACD の計算に十分なデータがありません。",
      s5Title: "ボラティリティ包絡線 ― ボリンジャー(20,2σ)",
      s5Detail:
        "上限 {upper} / 下限 {lower}。価格は包絡線の {position}% の位置（バンド幅 {bandwidth}%）→ {note}。",
      s5NoData: "ボリンジャーバンドの計算に十分なデータがありません。",
      s6Title: "リスク計器 ― 実現ボラティリティ",
      s6Detail:
        "30 日 σ_日次 = {daily}% → 年率 ≈ {annualized}%。ポジションサイズはこの数値に反比例させて。",
      s7Title: "参加度 ― 出来高トレンド",
      s7Detail: "24 時間出来高 {volume} は 30 日平均の約 {trend} → {note}。",
      s8Title: "因子ブレンド ― 加重複合",
      s8Detail:
        "指標マッピング軸: モメンタム {momentum}、トレンド {trend}、ボラティリティ {volatility}。頂点の重みを融合した複合スコアは {score}/100。",
      s9Title: "文脈 ― 90 日価格パーセンタイル",
      s9Detail: "現在価格は 90 日レンジの第 {rank} パーセンタイル ― {note}。",
      s10Title: "将来投影",
      s10Detail:
        "{days}{daysShort}で、スコア調整済みドリフト μ̂ = {drift}{perDayShort} → 期待価格 ≈ {price}（{change}）。",
      s11Title: "判定",
      s11Detail:
        "複合 {score}/100 → {action} バイアス、信頼度 {confidence}%。エントリー {entry}、ストップ {stop}、第一目標 {target}。",
    },
  },

  news: {
    index: "04 / ニュース集約",
    title: "信頼できるメディアが今日伝えていること",
    subtitle:
      "確立された暗号資産・市場編集デスク（CoinDesk、Cointelegraph、Reuters、Bloomberg、The Block など）から集約し、重複を排除してランキング ― 信頼できるソースを優先。",
    feed: "フィード",
    refresh: "フィードを更新",
    refreshing: "集約中…",
    trustedOnly: "信頼できるソースのみ",
    allSources: "すべてのソース",
    liveVia: "ウェブ検索でライブ取得",
    cachedBrief: "キャッシュ済みブリーフ（検索不可）",
    noMatch: "現在のフィルターに一致する記事はありません。「すべてのソース」を試すか更新してください。",
  },

  footer: {
    about:
      "CryptoPulse ― 高出来高暗号資産の毎日のトレンド追跡。ニュースは信頼できる公開メディアから集約。",
    disclaimer:
      "情報提供のみを目的としています。投資助言ではありません ― モデルは間違うことも、市場はもっと不条理なことも。リスク管理を。",
  },
};

export default ja;
