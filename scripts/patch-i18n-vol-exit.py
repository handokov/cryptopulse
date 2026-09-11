#!/usr/bin/env python3
"""Add 7 VOL-exit-style i18n keys to every bot section (en/id/zh/es/pt/ja)."""
import re, sys

BASE = "/home/z/my-project/src/i18n/messages"

KEYS = {
    "en": {
        "exitStyle": "Exit style",
        "exitStyleFixed": "Fixed %",
        "exitStyleFixedHint": "TP/SL as fixed percent — the mode preset or your custom values.",
        "exitStyleVol": "Volatility (auto)",
        "exitStyleVolHint": "Bands scale with the asset's own 4H volatility: SL 0.8\u03c3, TP 1.2\u03c3 + trailing stop.",
        "exitStyleVolNote": "\u03c3 = stdev of the last 90 4H returns. A custom TP/SL in Advanced still wins when filled. Applies to positions opened after saving.",
        "exit_trail_stop": "trail-stop \u00d7{count}",
    },
    "id": {
        "exitStyle": "Gaya exit",
        "exitStyleFixed": "Persen tetap",
        "exitStyleFixedHint": "TP/SL persen tetap \u2014 preset mode atau nilai kustom Anda.",
        "exitStyleVol": "Volatilitas (otomatis)",
        "exitStyleVolHint": "Band menyesuaikan volatilitas 4H aset: SL 0,8\u03c3, TP 1,2\u03c3 + trailing stop.",
        "exitStyleVolNote": "\u03c3 = simpangan baku 90 return 4H terakhir. TP/SL kustom di Advanced tetap menang bila diisi. Berlaku untuk posisi yang dibuka setelah menyimpan.",
        "exit_trail_stop": "trail-stop \u00d7{count}",
    },
    "zh": {
        "exitStyle": "\u9000\u51fa\u65b9\u5f0f",
        "exitStyleFixed": "\u56fa\u5b9a\u767e\u5206\u6bd4",
        "exitStyleFixedHint": "TP/SL \u4e3a\u56fa\u5b9a\u767e\u5206\u6bd4\u2014\u2014\u6a21\u5f0f\u9884\u8bbe\u6216\u4f60\u7684\u81ea\u5b9a\u4e49\u503c\u3002",
        "exitStyleVol": "\u6ce2\u52a8\u7387\uff08\u81ea\u52a8\uff09",
        "exitStyleVolHint": "\u533a\u95f4\u968f\u8d44\u4ea7 4H \u6ce2\u52a8\u7387\u7f29\u653e\uff1aSL 0.8\u03c3\u3001TP 1.2\u03c3 + \u79fb\u52a8\u6b62\u76c8\u6b62\u635f\u3002",
        "exitStyleVolNote": "\u03c3 = \u6700\u8fd1 90 \u6839 4H \u6536\u76ca\u7387\u7684\u6807\u51c6\u5dee\u3002\u9ad8\u7ea7\u8bbe\u7f6e\u4e2d\u5df2\u586b\u5199\u7684\u81ea\u5b9a\u4e49 TP/SL \u4ecd\u7136\u4f18\u5148\u3002\u4ec5\u9002\u7528\u4e8e\u4fdd\u5b58\u540e\u65b0\u5f00\u7684\u4ed3\u4f4d\u3002",
        "exit_trail_stop": "\u79fb\u52a8\u6b62\u635f \u00d7{count}",
    },
    "es": {
        "exitStyle": "Estilo de salida",
        "exitStyleFixed": "Porcentaje fijo",
        "exitStyleFixedHint": "TP/SL en porcentaje fijo: preset del modo o tus valores personalizados.",
        "exitStyleVol": "Volatilidad (auto)",
        "exitStyleVolHint": "Bandas escaladas a la volatilidad 4H del activo: SL 0,8\u03c3, TP 1,2\u03c3 + stop m\u00f3vil.",
        "exitStyleVolNote": "\u03c3 = desviaci\u00f3n est\u00e1ndar de los \u00faltimos 90 retornos de 4H. Un TP/SL personalizado en Avanzado sigue teniendo prioridad si est\u00e1 lleno. Se aplica a posiciones abiertas despu\u00e9s de guardar.",
        "exit_trail_stop": "stop m\u00f3vil \u00d7{count}",
    },
    "pt": {
        "exitStyle": "Estilo de sa\u00edda",
        "exitStyleFixed": "Percentual fixo",
        "exitStyleFixedHint": "TP/SL em percentual fixo \u2014 predefini\u00e7\u00e3o do modo ou seus valores personalizados.",
        "exitStyleVol": "Volatilidade (auto)",
        "exitStyleVolHint": "Faixas escaladas pela volatilidade 4H do ativo: SL 0,8\u03c3, TP 1,2\u03c3 + stop m\u00f3vel.",
        "exitStyleVolNote": "\u03c3 = desvio padr\u00e3o dos \u00faltimos 90 retornos de 4H. Um TP/SL personalizado em Avan\u00e7ado ainda vence quando preenchido. Vale para posi\u00e7\u00f5es abertas ap\u00f3s salvar.",
        "exit_trail_stop": "stop m\u00f3vel \u00d7{count}",
    },
    "ja": {
        "exitStyle": "\u6c7a\u6e08\u30b9\u30bf\u30a4\u30eb",
        "exitStyleFixed": "\u56fa\u5b9a\uff05",
        "exitStyleFixedHint": "TP/SL\u3092\u56fa\u5b9a\u30d1\u30fc\u30bb\u30f3\u30c8\u3067\u8a2d\u5b9a \u2014 \u30e2\u30fc\u30c9\u306e\u30d7\u30ea\u30bb\u30c3\u30c8\u307e\u305f\u306f\u30ab\u30b9\u30bf\u30e0\u5024\u3002",
        "exitStyleVol": "\u30dc\u30e9\u30c6\u30a3\u30ea\u30c6\u30a3\uff08\u81ea\u52d5\uff09",
        "exitStyleVolHint": "\u8cc7\u7523\u306e4H\u30dc\u30e9\u30c6\u30a3\u30ea\u30c6\u30a3\u306b\u5fdc\u3058\u3066\u5e2f\u57df\u3092\u8abf\u6574\uff1aSL 0.8\u03c3\u3001TP 1.2\u03c3 + \u30c8\u30ec\u30fc\u30ea\u30f3\u30b0\u30b9\u30c8\u30c3\u30d7\u3002",
        "exitStyleVolNote": "\u03c3 = \u76f4\u8fd190\u672c\u306e4H\u30ea\u30bf\u30fc\u30f3\u306e\u6a19\u6e96\u504f\u5dee\u3002\u9ad8\u5ea6\u306a\u8a2d\u5b9a\u306e\u30ab\u30b9\u30bf\u30e0TP/SL\u5165\u529b\u6642\u306f\u305d\u3061\u3089\u304c\u512a\u5148\u3002\u4fdd\u5b58\u5f8c\u306b\u958b\u3044\u305f\u30dd\u30b8\u30b7\u30e7\u30f3\u306b\u9069\u7528\u3002",
        "exit_trail_stop": "\u30c8\u30ec\u30fc\u30ea\u30f3\u30b0 \u00d7{count}",
    },
}

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

for lang, keys in KEYS.items():
    path = f"{BASE}/{lang}.ts"
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if "exitStyleVol" in src:
        print(f"{lang}: already patched, skip")
        continue
    # insert after the slOverride line inside the bot section
    m = re.search(r'(    slOverride: "[^"]*",\n)', src)
    if not m:
        print(f"{lang}: ERROR - slOverride anchor not found"); sys.exit(1)
    block = "".join(f'    {k}: "{esc(v)}",\n' for k, v in keys.items())
    out = src[:m.end()] + block + src[m.end():]
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"{lang}: +{len(keys)} keys")

print("done")
