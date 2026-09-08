/** Catálogo em português (Brasil). Chaves idênticas a en.ts. */

import type { Messages } from "./en";

const pt: Messages = {
  nav: {
    markets: "Mercados",
    news: "Notícias",
    labs: "Laboratórios de sinal",
    analysis: "Análise",
    language: "Idioma",
  },

  hero: {
    badge: "Os mercados nunca dormem — nós também não",
    tagline: "inteligência de mercado, visualizada",
    subtitle:
      "Acompanhamento diário de tendências dos criptoativos de maior volume, agregado com fontes de notícias confiáveis. Arraste vértices de sinal, ajuste funções de projeção com controles deslizantes e veja a análise prospectiva se desdobrar passo a passo.",
    ctaMarket: "Acompanhar o mercado",
    ctaAnalysis: "Executar análise prospectiva",
  },

  markets: {
    index: "01 / MERCADOS",
    title: "Acompanhamento diário de tendências — ativos de alto volume",
    subtitle:
      "Retrato ao vivo dos criptoativos mais líquidos. Os minigráficos mostram as últimas 30 sessões; clique em qualquer cartão para focar todos os laboratórios e o motor de análise nesse ativo.",
    vol: "Vol {value}",
    mcap: "Cap. mercado {value}",
    tracking: "ACOMPANHANDO",
    selectAria: "Selecionar {name} para análise",
  },

  labs: {
    index: "02 / LABORATÓRIOS DE SINAL",
    title: "Modele o sinal e depois dobre a curva",
    subtitle:
      "O Polígono de Sinal transforma pesos de fatores em geometria — arraste os vértices e veja os valores em tempo real. O Laboratório de Projeção converte essas suposições em uma função de preço controlada por deslizantes, com banda de confiança.",
    polygonTitle: "Polígono de Sinal",
    projectionTitle: "Laboratório de Projeção",
    weightsTo: "pesos → análise",
    sourceLive: "CoinGecko ao vivo · cache de 2 min",
    sourceModel: "modelo interno · cache de 2 min",
  },

  factors: {
    momentum: { label: "Momento", hint: "Regime de RSI / taxa de variação" },
    trend: { label: "Tendência", hint: "Estrutura de médias móveis" },
    volume: { label: "Volume", hint: "Participação e fluxo" },
    volatility: { label: "Volatilidade", hint: "Envelope de risco realizado" },
    sentiment: { label: "Sentimento", hint: "Tom de notícias e narrativas" },
    liquidity: { label: "Liquidez", hint: "Profundidade e spreads" },
  },

  polygon: {
    aria: "Polígono de fatores arrastável — arraste os vértices para ajustar os pesos",
    dragHint: "Arraste qualquer vértice — os valores atualizam em tempo real",
    composite: "Composto ao vivo",
    compositeHint:
      "Combina os pesos dos seus vértices com sinais de indicadores ao vivo de {symbol}. Os pesos fluem direto para a análise prospectiva abaixo.",
    autoTune: "Ajuste automático pelo mercado",
    resetAria: "Redefinir fatores para 50",
  },

  projection: {
    loading: "Carregando modelo de projeção…",
    horizon: { label: "Horizonte", hint: "Janela de projeção" },
    drift: { label: "Viés de deriva μ̂", hint: "Incline a tendência" },
    vol: { label: "Volatilidade ×", hint: "Largura da banda de confiança" },
    waveAmp: { label: "Amplitude da onda A", hint: "Tamanho do balanço cíclico" },
    wavePeriod: { label: "Período da onda T", hint: "Comprimento do ciclo" },
    daysShort: "d",
    perDayShort: "/d",
    projectedAt: "Projeção em {days}{daysShort}",
    expectedMove: "Movimento esperado",
    driftPerDay: "Deriva μ̂ / dia",
    annVol: "σ anualizada",
    today: "hoje",
    now: "agora {price}",
  },

  analysis: {
    index: "03 / ANÁLISE PROSPECTIVA",
    title: "Vereditos de trading passo a passo, linha por linha",
    subtitle:
      "Uma execução calcula o viés de SMA, RSI, MACD, envelope de Bollinger, volatilidade realizada, participação do volume e a sua mistura de vértices — cada etapa revelada linha por linha com leitura colorida.",
    run: "Executar análise prospectiva",
    analyzing: "Analisando…",
    placeholderBefore: "Pressione",
    placeholderAfter: "para desdobrar a solução linha por linha.",
    computing: "amostrando a série de {symbol}, combinando {count} vértices personalizados…",
    emptyVerdict:
      "Veredito, confiança e zonas-alvo aparecem aqui quando a execução linha por linha termina.",
    verdict: "Veredito",
    compositeScore: "Pontuação composta",
    confidence: "Confiança ≈ {value}%",
    modelExpects:
      "O modelo espera {price} em {days}{daysShort} ({change}). Confira o fluxo de notícias antes de agir.",
    inputs:
      "Entradas atuais — {symbol}, horizonte {days}{daysShort}, vértices: {vertices}. Ajuste o Polígono de Sinal acima e execute novamente para comparar cenários.",
    targets: {
      entry: "Entrada",
      support: "Suporte",
      resistance: "Resist.",
      stop: "Stop",
      t1: "Meta 1",
      t2: "Meta 2",
    },
    actions: { long: "COMPRA", short: "VENDA", neutral: "NEUTRO" },
    sourceLive: "CoinGecko ao vivo",
    sourceModel: "modelo interno",
    directions: { above: "acima", below: "abaixo" },
    moods: { constructive: "construtivo", defensive: "defensivo" },
    rsi: {
      overbought: "sobrecompra",
      oversold: "sobrevenda",
      neutral: "zona neutra",
      noteOverbought: "Alta esticada aumenta as chances de correção.",
      noteOversold: "Níveis de capitulação costumam anteceder repiques de reversão à média.",
      noteNeutral: "O momento tem espaço para se estender em qualquer direção.",
    },
    regimes: { bullish: "regime de cruzamento de alta", bearish: "regime de cruzamento de baixa" },
    bb: {
      strong: "surfando a banda superior, tendência forte mas estendida",
      weak: "colado na banda inferior, tendência fraca ou exaurida",
      inside: "dentro do envelope",
    },
    volume: {
      expanding: "participação em expansão, os movimentos carregam convicção",
      cooling: "liquidez esfriando, rompimentos menos confiáveis",
    },
    percentile: {
      upper: "quartil superior: maior risco de perseguir altas",
      lower: "quartil inferior: candidatos a zona de acumulação",
      mid: "faixa intermediária: melhor seguir a tendência do que operar contra ela",
    },
    steps: {
      s1Title: "Carregar série do modelo",
      s1Detail: "Carregados {count} fechamentos diários terminando em {price} (fonte: {source}).",
      s2Title: "Base de tendência — viés de SMA",
      s2Detail:
        "SMA₅₀ = {sma50}, SMA₂₀ = {sma20}. O preço está {bias} {direction} da média de 50 dias → contexto de tendência {mood}.",
      s3Title: "Momento — RSI(14)",
      s3Detail: "RSI(14) = {rsi} → {zone}. {note}",
      s4Title: "Fluxo de tendência — MACD(12,26,9)",
      s4Detail: "MACD = {macd}, sinal = {signal}, histograma = {hist} → {regime}.",
      s4NoData: "Dados insuficientes para o MACD.",
      s5Title: "Envelope de volatilidade — Bollinger(20,2σ)",
      s5Detail:
        "Superior {upper} / inferior {lower}. Preço em {position}% do envelope (largura de banda {bandwidth}%) → {note}.",
      s5NoData: "Dados insuficientes para as bandas de Bollinger.",
      s6Title: "Medidor de risco — volatilidade realizada",
      s6Detail:
        "σ_diária 30 dias = {daily}% → anualizada ≈ {annualized}%. O tamanho da posição deve escalar de forma inversa a esse número.",
      s7Title: "Participação — tendência de volume",
      s7Detail: "O volume de 24 h {volume} equivale a ≈ {trend} vs a média de 30 dias → {note}.",
      s8Title: "Mistura de fatores — composto ponderado",
      s8Detail:
        "Eixos mapeados por indicadores: momento {momentum}, tendência {trend}, volatilidade {volatility}. Seus pesos de vértices geraram uma pontuação composta de {score}/100.",
      s9Title: "Contexto — percentil de preço de 90 dias",
      s9Detail: "O preço atual está no percentil {rank} da faixa de 90 dias — {note}.",
      s10Title: "Projeção prospectiva",
      s10Detail:
        "Em {days}{daysShort}, com deriva ajustada por pontuação μ̂ = {drift}{perDayShort} → preço esperado ≈ {price} ({change}).",
      s11Title: "Veredito",
      s11Detail:
        "Composto {score}/100 → viés {action} com {confidence}% de confiança. Entrada {entry}, stop {stop}, primeira meta {target}.",
    },
  },

  news: {
    index: "04 / AGREGAÇÃO DE NOTÍCIAS",
    title: "O que os veículos confiáveis publicam hoje",
    subtitle:
      "Agregado de mesas editoriais consolidadas de cripto e mercados (CoinDesk, Cointelegraph, Reuters, Bloomberg, The Block e mais), deduplicado e classificado — fontes confiáveis primeiro.",
    feed: "Feed",
    refresh: "Atualizar feed",
    refreshing: "Agregando…",
    trustedOnly: "Somente fontes confiáveis",
    allSources: "Todas as fontes",
    liveVia: "ao vivo via busca na web",
    cachedBrief: "resumo em cache (busca indisponível)",
    noMatch: "Nenhuma notícia corresponde ao filtro atual. Tente “Todas as fontes” ou atualize.",
  },

  footer: {
    about:
      "CryptoPulse — acompanhamento diário de tendências de criptoativos de alto volume. Notícias agregadas de veículos públicos confiáveis.",
    disclaimer:
      "Apenas para fins informativos. Nada aqui é recomendação financeira — modelos podem errar e os mercados podem ser mais estranhos. Gerencie seu risco.",
  },
};

export default pt;
