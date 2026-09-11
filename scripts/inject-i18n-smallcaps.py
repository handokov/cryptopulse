#!/usr/bin/env python3
"""Inject smallcaps screener keys into the top100 namespace of all 6 locales."""

import re

KEYS = {
    "id": {
        "boardTab": "Top 100",
        "smallcapsTab": "Small-caps (Bitget)",
        "smallcapsHint": "Pair USDT Bitget di luar papan top-100 — saham ter-tokenisasi, stablecoin, dan token leveraged disaring. Volume 24 jam ≥ {vol}. Klik baris untuk membuka pair di Bitget.",
        "smallcapsSearch": "Cari aset atau pair…",
        "smallcapsRange": "Rentang 24j",
        "smallcapsListed": "Listing",
        "smallcapsFresh": "baru",
        "smallcapsAge": "{days} hr",
        "smallcapsEmpty": "Tidak ada pair di atas ambang volume ini.",
        "smallcapsTotal": "{count} pair lolos",
    },
    "en": {
        "boardTab": "Top 100",
        "smallcapsTab": "Small-caps (Bitget)",
        "smallcapsHint": "Bitget USDT pairs outside the top-100 board — tokenized stocks, stablecoins and leveraged tokens are filtered out. 24h volume ≥ {vol}. Click a row to open the pair on Bitget.",
        "smallcapsSearch": "Search asset or pair…",
        "smallcapsRange": "24h range",
        "smallcapsListed": "Listed",
        "smallcapsFresh": "new",
        "smallcapsAge": "{days} d",
        "smallcapsEmpty": "No pairs above this volume threshold.",
        "smallcapsTotal": "{count} pairs match",
    },
    "es": {
        "boardTab": "Top 100",
        "smallcapsTab": "Small-caps (Bitget)",
        "smallcapsHint": "Pares USDT de Bitget fuera del top-100 — se filtran acciones tokenizadas, stablecoins y tokens apalancados. Volumen 24 h ≥ {vol}. Haz clic en una fila para abrir el par en Bitget.",
        "smallcapsSearch": "Buscar activo o par…",
        "smallcapsRange": "Rango 24 h",
        "smallcapsListed": "Listado",
        "smallcapsFresh": "nuevo",
        "smallcapsAge": "{days} d",
        "smallcapsEmpty": "Ningún par supera este umbral de volumen.",
        "smallcapsTotal": "{count} pares coinciden",
    },
    "pt": {
        "boardTab": "Top 100",
        "smallcapsTab": "Small-caps (Bitget)",
        "smallcapsHint": "Pares USDT da Bitget fora do top-100 — ações tokenizadas, stablecoins e tokens alavancados são filtrados. Volume 24 h ≥ {vol}. Clique numa linha para abrir o par na Bitget.",
        "smallcapsSearch": "Pesquisar ativo ou par…",
        "smallcapsRange": "Faixa 24 h",
        "smallcapsListed": "Listado",
        "smallcapsFresh": "novo",
        "smallcapsAge": "{days} d",
        "smallcapsEmpty": "Nenhum par acima deste limite de volume.",
        "smallcapsTotal": "{count} pares correspondem",
    },
    "ja": {
        "boardTab": "Top 100",
        "smallcapsTab": "小型銘柄 (Bitget)",
        "smallcapsHint": "BitgetのUSDTペア（トップ100以外）。トークン化株式・ステーブルコイン・レバレッジトークンは除外。24時間出来高 ≥ {vol}。行をクリックするとBitgetでペアを開きます。",
        "smallcapsSearch": "資産またはペアを検索…",
        "smallcapsRange": "24hレンジ",
        "smallcapsListed": "上場",
        "smallcapsFresh": "新規",
        "smallcapsAge": "{days}日",
        "smallcapsEmpty": "この出来高しきい値を超えるペアはありません。",
        "smallcapsTotal": "{count}銘柄が該当",
    },
    "zh": {
        "boardTab": "Top 100",
        "smallcapsTab": "小市值 (Bitget)",
        "smallcapsHint": "Bitget 的 USDT 交易对（前100以外）——已过滤代币化股票、稳定币与杠杆代币。24小时成交量 ≥ {vol}。点击行可在 Bitget 打开该交易对。",
        "smallcapsSearch": "搜索资产或交易对…",
        "smallcapsRange": "24小时区间",
        "smallcapsListed": "上线",
        "smallcapsFresh": "新",
        "smallcapsAge": "{days} 天",
        "smallcapsEmpty": "没有超过该成交量门槛的交易对。",
        "smallcapsTotal": "共 {count} 个交易对",
    },
}

for lang, kv in KEYS.items():
    path = f"src/i18n/messages/{lang}.ts"
    src = open(path, encoding="utf-8").read()
    if "smallcapsTab" in src:
        print(f"{lang}: already injected, skip")
        continue
    m = re.search(r'(    loadingCoin: "[^"]*",\n)', src)
    if not m:
        print(f"{lang}: ANCHOR NOT FOUND — aborting")
        raise SystemExit(1)
    block = "".join(f'    {k}: {v!s},\n' for k, v in kv.items())
    # quote as JS strings (keep unicode as-is, escape double quotes)
    block = "".join(
        f'    {k}: "{v}",\n' for k, v in kv.items()
    )
    src = src[: m.end(1)] + block + src[m.end(1):]
    open(path, "w", encoding="utf-8").write(src)
    print(f"{lang}: injected {len(kv)} keys")

print("done")
