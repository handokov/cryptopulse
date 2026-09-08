/** 简体中文目录。键结构与 en.ts 完全一致。 */

import type { Messages } from "./en";

const zh: Messages = {
  nav: {
    markets: "行情",
    news: "新闻",
    labs: "信号实验室",
    analysis: "分析",
    language: "语言",
  },

  hero: {
    badge: "市场永不休眠 —— 我们也是",
    tagline: "市场情报，可视化呈现",
    subtitle:
      "面向成交量最高的加密资产进行每日趋势追踪，并聚合可信新闻源。拖动信号顶点、用滑块调节投影函数，逐步见证前瞻分析的展开。",
    ctaMarket: "追踪行情",
    ctaAnalysis: "运行前瞻分析",
  },

  markets: {
    index: "01 / 行情",
    title: "每日趋势追踪 —— 高成交量资产",
    subtitle:
      "流动性最高的加密资产实时快照。迷你走势图展示最近 30 个交易日；点击任意卡片，即可让所有实验室与分析引擎聚焦该资产。",
    vol: "成交量 {value}",
    mcap: "市值 {value}",
    tracking: "追踪中",
    selectAria: "选择 {name} 进行分析",
  },

  labs: {
    index: "02 / 信号实验室",
    title: "先塑造信号，再弯曲曲线",
    subtitle:
      "信号多边形将因子权重化作几何图形 —— 拖动顶点，数值实时回读。投影实验室则把这些假设转化为由滑块驱动、带置信区间的价格函数。",
    polygonTitle: "信号多边形",
    projectionTitle: "投影实验室",
    weightsTo: "权重 → 分析",
    sourceLive: "CoinGecko 实时 · 2 分钟缓存",
    sourceModel: "内部模型 · 2 分钟缓存",
  },

  factors: {
    momentum: { label: "动量", hint: "RSI / 变化率状态" },
    trend: { label: "趋势", hint: "均线结构" },
    volume: { label: "成交量", hint: "参与度与资金流" },
    volatility: { label: "波动率", hint: "已实现风险区间" },
    sentiment: { label: "情绪", hint: "新闻与叙事基调" },
    liquidity: { label: "流动性", hint: "深度与点差" },
  },

  polygon: {
    aria: "可拖动的因子多边形 —— 拖动顶点以调整因子权重",
    dragHint: "拖动任意顶点 —— 数值实时更新",
    composite: "实时综合分",
    compositeHint:
      "将你的顶点权重与 {symbol} 的实时指标信号相融合。权重会直接流入下方的前瞻分析。",
    autoTune: "按行情自动调校",
    resetAria: "将因子重置为 50",
  },

  projection: {
    loading: "正在加载投影模型…",
    horizon: { label: "时间跨度", hint: "投影窗口" },
    drift: { label: "漂移偏置 μ̂", hint: "倾斜趋势" },
    vol: { label: "波动率 ×", hint: "置信区间宽度" },
    waveAmp: { label: "波浪振幅 A", hint: "周期性摆动幅度" },
    wavePeriod: { label: "波浪周期 T", hint: "周期长度" },
    daysShort: "天",
    perDayShort: "/天",
    projectedAt: "{days}{daysShort}后预测",
    expectedMove: "预期变动",
    driftPerDay: "漂移 μ̂ / 天",
    annVol: "年化 σ",
    today: "今天",
    now: "现价 {price}",
  },

  analysis: {
    index: "03 / 前瞻分析",
    title: "逐步交易研判，逐行呈现",
    subtitle:
      "一次运行即可计算 SMA 偏离、RSI、MACD、布林包络、已实现波动率、成交量参与度与你的顶点混合 —— 每一步都逐行揭示，并配以颜色编码。",
    run: "运行前瞻分析",
    analyzing: "分析中…",
    placeholderBefore: "按下",
    placeholderAfter: "逐行展开求解过程。",
    computing: "正在采样 {symbol} 序列，混合 {count} 个自定义顶点…",
    emptyVerdict: "逐行运行完成后，研判、置信度与目标区间将在此显示。",
    verdict: "研判",
    compositeScore: "综合得分",
    confidence: "置信度 ≈ {value}%",
    modelExpects: "模型预计 {days}{daysShort} 后为 {price}（{change}）。行动前请对照新闻流核实。",
    inputs:
      "当前输入 —— {symbol}，跨度 {days}{daysShort}，顶点：{vertices}。调整上方信号多边形后重新运行以比较情景。",
    targets: {
      entry: "入场",
      support: "支撑",
      resistance: "阻力",
      stop: "止损",
      t1: "目标1",
      t2: "目标2",
    },
    actions: { long: "做多", short: "做空", neutral: "中性" },
    sourceLive: "CoinGecko 实时",
    sourceModel: "内部模型",
    directions: { above: "上方", below: "下方" },
    moods: { constructive: "建设性", defensive: "防御性" },
    rsi: {
      overbought: "超买",
      oversold: "超卖",
      neutral: "中性区间",
      noteOverbought: "上行过度拉伸，回调概率上升。",
      noteOversold: "投降式抛售水平往往预示均值回归式反弹。",
      noteNeutral: "动能仍可向任一方向延展。",
    },
    regimes: { bullish: "多头交叉状态", bearish: "空头交叉状态" },
    bb: {
      strong: "贴着上轨运行，趋势强劲但已伸展",
      weak: "贴着下轨运行，趋势疲弱或已出清",
      inside: "位于包络之内",
    },
    volume: {
      expanding: "参与度扩张，行情更具信念",
      cooling: "流动性降温，突破的可靠性下降",
    },
    percentile: {
      upper: "上四分位：追高风险上升",
      lower: "下四分位：吸筹区候选",
      mid: "中段：更适合顺势而非逆势交易",
    },
    steps: {
      s1Title: "加载模型序列",
      s1Detail: "已加载 {count} 个每日收盘价，终点 {price}（来源：{source}）。",
      s2Title: "趋势基线 —— SMA 偏离",
      s2Detail:
        "SMA₅₀ = {sma50}，SMA₂₀ = {sma20}。价格位于 50 日均线 {direction} {bias} → 趋势背景偏{mood}。",
      s3Title: "动量 —— RSI(14)",
      s3Detail: "RSI(14) = {rsi} → {zone}。{note}",
      s4Title: "趋势流向 —— MACD(12,26,9)",
      s4Detail: "MACD = {macd}，信号线 = {signal}，柱状 = {hist} → {regime}。",
      s4NoData: "数据不足，无法计算 MACD。",
      s5Title: "波动率包络 —— 布林带(20,2σ)",
      s5Detail:
        "上轨 {upper} / 下轨 {lower}。价格处于包络 {position}% 的位置（带宽 {bandwidth}%）→ {note}。",
      s5NoData: "数据不足，无法计算布林带。",
      s6Title: "风险量规 —— 已实现波动率",
      s6Detail:
        "30 日 σ_日 = {daily}% → 年化 ≈ {annualized}%。仓位规模应与该数值成反比。",
      s7Title: "参与度 —— 成交量趋势",
      s7Detail: "24 小时成交量 {volume} 约为 30 日均量的 {trend} → {note}。",
      s8Title: "因子混合 —— 加权综合",
      s8Detail:
        "指标映射轴：动量 {momentum}、趋势 {trend}、波动率 {volatility}。你的顶点权重混合后的综合得分为 {score}/100。",
      s9Title: "背景 —— 90 日价格百分位",
      s9Detail: "当前价格处于 90 日区间的第 {rank} 百分位 —— {note}。",
      s10Title: "前瞻投影",
      s10Detail:
        "在 {days}{daysShort} 内，按得分调整后的漂移 μ̂ = {drift}{perDayShort} → 预期价格 ≈ {price}（{change}）。",
      s11Title: "研判",
      s11Detail:
        "综合 {score}/100 → {action}倾向，置信度 {confidence}%。入场 {entry}，止损 {stop}，第一目标 {target}。",
    },
  },

  news: {
    index: "04 / 新闻聚合",
    title: "可信媒体今日报道了什么",
    subtitle:
      "聚合自成熟的加密与市场编辑团队（CoinDesk、Cointelegraph、Reuters、Bloomberg、The Block 等），去重并排序 —— 可信来源优先。",
    feed: "新闻流",
    refresh: "刷新新闻流",
    refreshing: "聚合中…",
    trustedOnly: "仅可信来源",
    allSources: "全部来源",
    liveVia: "通过网络搜索实时获取",
    cachedBrief: "缓存简报（搜索不可用）",
    noMatch: "当前筛选条件下没有匹配的新闻。试试“全部来源”或刷新。",
  },

  footer: {
    about:
      "CryptoPulse —— 面向高成交量加密资产的每日趋势追踪。新闻聚合自可信的公开媒体。",
    disclaimer:
      "仅供参考，不构成投资建议 —— 模型可能出错，市场可能更离谱。请管理好自己的风险。",
  },
};

export default zh;
