# -*- coding: utf-8 -*-
"""Task 20 i18n — exit-guardian keys in 6 locales (en/id/zh/es/pt/ja).

1. Inserts `disabledManagedNote` into the `bot` namespace (anchored after the
   ocoHint line) — amber chip shown when a disabled bot still has an open
   position.
2. REPLACES the `alwaysOn` copy in all locales: the engine now ticks via
   server cron + page heartbeat, and open positions stay managed even while
   the bot is disabled.
"""
import re, sys

BOT_NEW = {
    "en": {
        "disabledManagedNote": "Bot is off — no new entries, but open positions keep their take-profit / stop-loss / trailing management.",
        "alwaysOn": "The engine ticks every ~5 min: server cron + this page's heartbeat while open. Open positions keep their take-profit / stop-loss even with the page closed or the bot disabled.",
    },
    "id": {
        "disabledManagedNote": "Bot nonaktif — posisi baru tidak dibuka, tapi posisi terbuka tetap dijaga take profit / stop loss / trailing oleh engine.",
        "alwaysOn": "Engine men-tick tiap ±5 menit: cron server + heartbeat halaman ini saat terbuka. Posisi terbuka tetap dijaga take-profit / stop-loss walau halaman ditutup atau bot dinonaktifkan.",
    },
    "zh": {
        "disabledManagedNote": "机器人已停用——不再开新仓，但持仓的止盈 / 止损 / 移动止损仍由引擎持续管理。",
        "alwaysOn": "引擎约每 5 分钟运行一次：服务器 cron + 本页打开时的心跳。即使关闭页面或停用机器人，持仓的止盈 / 止损仍会被守护。",
    },
    "es": {
        "disabledManagedNote": "Bot desactivado: no abre posiciones nuevas, pero las abiertas siguen con toma de ganancias / stop-loss / trailing.",
        "alwaysOn": "El motor opera cada ~5 min: cron del servidor + el latido de esta página mientras esté abierta. Las posiciones abiertas mantienen su TP / SL aunque cierres la página o desactives el bot.",
    },
    "pt": {
        "disabledManagedNote": "Bot desligado — não abre novas posições, mas as abertas continuam com realização de lucro / stop-loss / trailing.",
        "alwaysOn": "O motor opera a cada ~5 min: cron do servidor + o heartbeat desta página enquanto aberta. Posições abertas mantêm TP / SL mesmo com a página fechada ou o bot desligado.",
    },
    "ja": {
        "disabledManagedNote": "ボットは停止中 — 新規エントリーはありませんが、保有ポジションのTP / SL / トレーリングはエンジンが管理し続けます。",
        "alwaysOn": "エンジンは約5分ごとに動作：サーバーcron＋このページを開いている間のハートビート。ページを閉じてもボット停止中でも、保有ポジションのTP / SLは守られます。",
    },
}

base = "/home/z/my-project/src/i18n/messages"
failed = False
for loc in ["en", "id", "zh", "es", "pt", "ja"]:
    path = f"{base}/{loc}.ts"
    with open(path, encoding="utf-8") as f:
        src = f.read()
    orig = src

    # 1. insert disabledManagedNote after the ocoHint anchor
    new_line = f'    disabledManagedNote: "{BOT_NEW[loc]["disabledManagedNote"]}",'
    src, n1 = re.subn(
        r'^    ocoHint: ".*",$',
        lambda m: m.group(0) + "\n" + new_line,
        src, count=1, flags=re.M,
    )

    # 2. replace the (multiline) alwaysOn entry — value sits on the next line
    src, n2 = re.subn(
        r'^    alwaysOn:\n\s*"[^"]*",',
        f'    alwaysOn:\n      "{BOT_NEW[loc]["alwaysOn"]}",',
        src, count=1, flags=re.M,
    )

    ok = n1 == 1 and n2 == 1 and src != orig
    if not ok:
        print(f"[FAIL] {loc}: ocoHint={n1} alwaysOn={n2}")
        failed = True
        continue
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] {loc}")

sys.exit(1 if failed else 0)
