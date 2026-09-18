# -*- coding: utf-8 -*-
"""Task 21 i18n — tick-health keys in 6 locales (en/id/zh/es/pt/ja).

Inserts into the `bot` namespace (anchored after the disabledManagedNote line):
  lastTick, tickAgo, tickNever, tickHint
"""
import re, sys

BOT_NEW = {
    "en": {
        "lastTick": "Last tick",
        "tickAgo": "{min} min ago",
        "tickNever": "never",
        "tickHint": "Age of the engine's last decision for this bot — should stay under ~10 min while the cron/heartbeat is healthy. A disabled bot with no open position is intentionally not ticked.",
    },
    "id": {
        "lastTick": "Tick terakhir",
        "tickAgo": "{min} mnt lalu",
        "tickNever": "belum pernah",
        "tickHint": "Umur keputusan engine terakhir untuk bot ini — sehatnya di bawah ±10 menit selama cron/heartbeat jalan. Bot nonaktif tanpa posisi terbuka memang tidak di-tick.",
    },
    "zh": {
        "lastTick": "上次心跳",
        "tickAgo": "{min} 分钟前",
        "tickNever": "从未",
        "tickHint": "引擎对本 bot 上次决策的间隔——cron/心跳健康时应保持在约 10 分钟内。已停用且无持仓的 bot 不会被 tick。",
    },
    "es": {
        "lastTick": "Último tick",
        "tickAgo": "hace {min} min",
        "tickNever": "nunca",
        "tickHint": "Antigüedad de la última decisión del motor para este bot — debería ser < ~10 min con el cron/latido sano. Un bot desactivado sin posiciones no recibe ticks.",
    },
    "pt": {
        "lastTick": "Último tick",
        "tickAgo": "há {min} min",
        "tickNever": "nunca",
        "tickHint": "Idade da última decisão do motor para este bot — deve ficar abaixo de ~10 min com cron/heartbeat saudável. Bot desligado sem posição aberta não é tickado.",
    },
    "ja": {
        "lastTick": "最終ティック",
        "tickAgo": "{min}分前",
        "tickNever": "まだ無し",
        "tickHint": "エンジンがこのボットについて最後に判断した時刻の古さ——cron/ハートビートが正常なら約10分以内。停止中でポジションのないボットはティックされません。",
    },
}

base = "/home/z/my-project/src/i18n/messages"
failed = False
for loc in ["en", "id", "zh", "es", "pt", "ja"]:
    path = f"{base}/{loc}.ts"
    with open(path, encoding="utf-8") as f:
        src = f.read()
    orig = src
    new_lines = "\n".join(f'    {k}: "{BOT_NEW[loc][k]}",' for k in ["lastTick", "tickAgo", "tickNever", "tickHint"])
    src, n = re.subn(
        r'^    disabledManagedNote: ".*",$',
        lambda m: m.group(0) + "\n" + new_lines,
        src, count=1, flags=re.M,
    )
    if n != 1 or src == orig:
        print(f"[FAIL] {loc}: anchor={n}")
        failed = True
        continue
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] {loc}")

sys.exit(1 if failed else 0)
