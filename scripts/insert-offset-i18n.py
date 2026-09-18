# Insert limit-entry i18n keys (offsetField/offsetHint/walletPending) after
# modalHint in the bot namespace of all 6 locale message files.
import re, sys

BASE = "/home/z/my-project/src/i18n/messages"
TEXTS = {
    "en": (
        '    offsetField: "Entry offset (%)",',
        '    offsetHint: "0 = buy instantly at the market price. > 0 = wait with a limit that far BELOW the market (maker, never chases); unfilled orders expire after 3 candles.",',
        '    walletPending: "Limit entry waiting: {price} · TTL ~{mins}m",',
    ),
    "id": (
        '    offsetField: "Offset entry (%)",',
        '    offsetHint: "0 = langsung beli di harga market. > 0 = tunggu dengan limit sejauh itu DI BAWAH harga market (maker, tidak mengejar harga); order tak terisi hangus setelah 3 candle.",',
        '    walletPending: "Limit entry menunggu: {price} · TTL ~{mins}m",',
    ),
    "zh": (
        '    offsetField: "入场偏移 (%)",',
        '    offsetHint: "0 = 立即按市价买入。> 0 = 挂出低于市价该幅度的限价单等待成交（maker，不追价）；3 根K线内未成交自动失效。",',
        '    walletPending: "限价入场等待中：{price} · TTL 剩余约 {mins} 分钟",',
    ),
    "es": (
        '    offsetField: "Desvío de entrada (%)",',
        '    offsetHint: "0 = comprar al instante al precio de mercado. > 0 = esperar con una orden limitada ese porcentaje POR DEBAJO del mercado (maker, no persigue el precio); las órdenes sin ejecutar expiran tras 3 velas.",',
        '    walletPending: "Entrada límite en espera: {price} · TTL ~{mins} min",',
    ),
    "pt": (
        '    offsetField: "Desvio de entrada (%)",',
        '    offsetHint: "0 = comprar na hora pelo preço de mercado. > 0 = esperar com uma ordem limitada esse percentual ABAIXO do mercado (maker, não persegue o preço); ordens não executadas expiram após 3 velas.",',
        '    walletPending: "Entrada limite aguardando: {price} · TTL ~{mins} min",',
    ),
    "ja": (
        '    offsetField: "エントリー オフセット (%)",',
        '    offsetHint: "0 = 成行で即時購入。> 0 = 市場価格よりその分下に指値を出して待機（メーカー、価格を追わない）；3本のローソク内に約定しなければ失効。",',
        '    walletPending: "指値エントリー待機中：{price} · TTL 残り約 {mins} 分",',
    ),
}

ok = True
for loc, lines in TEXTS.items():
    path = f"{BASE}/{loc}.ts"
    src = open(path, encoding="utf-8").read()
    if "offsetField" in src:
        print(f"{loc}: already present, skip")
        continue
    m = re.search(r'^(\s*)modalHint: .*,\s*$', src, re.M)
    if not m:
        print(f"{loc}: modalHint anchor NOT found"); ok = False; continue
    indent = m.group(1)
    block = "\n".join(indent + ln.strip() for ln in lines)
    src = src[:m.end()] + "\n" + block + src[m.end():]
    open(path, "w", encoding="utf-8").write(src)
    print(f"{loc}: inserted 3 keys")
sys.exit(0 if ok else 1)
