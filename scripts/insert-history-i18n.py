# -*- coding: utf-8 -*-
"""Task 19 i18n — trade-history keys in 6 locales (en/id/zh/es/pt/ja).

Inserts into the `bot` namespace (anchored after the ocoHint line):
  historyTitle, historyNote, histClosed, histEntryExit, histResult,
  histDuration, histReason, avgDurWin, avgDurLoss, durH, durM,
  histReason_tp, histReason_sl, histReason_trail, histReason_flip,
  histReason_manual, histReason_other
"""
import re, sys

BOT_NEW = {
    "en": {
        "historyTitle": "Trade history",
        "historyNote": "Last {count} closed trades — newest first",
        "histClosed": "Closed",
        "histEntryExit": "Entry → Exit",
        "histResult": "Result",
        "histDuration": "Duration",
        "histReason": "Exit",
        "avgDurWin": "avg win duration: {value}",
        "avgDurLoss": "avg loss duration: {value}",
        "durH": "h",
        "durM": "m",
        "histReason_tp": "take-profit",
        "histReason_sl": "stop-loss",
        "histReason_trail": "trail-stop",
        "histReason_flip": "signal-flip",
        "histReason_manual": "manual close",
        "histReason_other": "other",
    },
    "id": {
        "historyTitle": "Riwayat Trade",
        "historyNote": "{count} trade terakhir — terbaru di atas",
        "histClosed": "Ditutup",
        "histEntryExit": "Entry → Exit",
        "histResult": "Hasil",
        "histDuration": "Durasi",
        "histReason": "Keluar",
        "avgDurWin": "rata-rata durasi profit: {value}",
        "avgDurLoss": "rata-rata durasi loss: {value}",
        "durH": "j",
        "durM": "m",
        "histReason_tp": "target profit",
        "histReason_sl": "stop loss",
        "histReason_trail": "trailing stop",
        "histReason_flip": "sinyal balik",
        "histReason_manual": "tutup manual",
        "histReason_other": "lainnya",
    },
    "zh": {
        "historyTitle": "交易历史",
        "historyNote": "最近 {count} 笔平仓交易（最新在前）",
        "histClosed": "平仓时间",
        "histEntryExit": "开仓 → 平仓",
        "histResult": "结果",
        "histDuration": "时长",
        "histReason": "退出",
        "avgDurWin": "盈利平均时长：{value}",
        "avgDurLoss": "亏损平均时长：{value}",
        "durH": "小时",
        "durM": "分",
        "histReason_tp": "止盈",
        "histReason_sl": "止损",
        "histReason_trail": "移动止损",
        "histReason_flip": "信号反转",
        "histReason_manual": "手动平仓",
        "histReason_other": "其他",
    },
    "es": {
        "historyTitle": "Historial de operaciones",
        "historyNote": "Últimas {count} operaciones cerradas — más recientes primero",
        "histClosed": "Cierre",
        "histEntryExit": "Entrada → Salida",
        "histResult": "Resultado",
        "histDuration": "Duración",
        "histReason": "Salida",
        "avgDurWin": "duración media de ganancia: {value}",
        "avgDurLoss": "duración media de pérdida: {value}",
        "durH": "h",
        "durM": "m",
        "histReason_tp": "toma de ganancias",
        "histReason_sl": "stop-loss",
        "histReason_trail": "stop dinámico",
        "histReason_flip": "cambio de señal",
        "histReason_manual": "cierre manual",
        "histReason_other": "otro",
    },
    "pt": {
        "historyTitle": "Histórico de negociações",
        "historyNote": "Últimas {count} negociações fechadas — mais recentes primeiro",
        "histClosed": "Fechamento",
        "histEntryExit": "Entrada → Saída",
        "histResult": "Resultado",
        "histDuration": "Duração",
        "histReason": "Saída",
        "avgDurWin": "duração média do lucro: {value}",
        "avgDurLoss": "duração média da perda: {value}",
        "durH": "h",
        "durM": "m",
        "histReason_tp": "realização de lucro",
        "histReason_sl": "stop-loss",
        "histReason_trail": "trailing stop",
        "histReason_flip": "inversão de sinal",
        "histReason_manual": "fechamento manual",
        "histReason_other": "outro",
    },
    "ja": {
        "historyTitle": "取引履歴",
        "historyNote": "直近{count}件の決済済み取引（新しい順）",
        "histClosed": "決済時刻",
        "histEntryExit": "エントリー → 決済",
        "histResult": "損益",
        "histDuration": "保有時間",
        "histReason": "決済",
        "avgDurWin": "利益の平均保有時間: {value}",
        "avgDurLoss": "損失の平均保有時間: {value}",
        "durH": "時間",
        "durM": "分",
        "histReason_tp": "利確",
        "histReason_sl": "損切り",
        "histReason_trail": "トレーリングストップ",
        "histReason_flip": "シグナル反転",
        "histReason_manual": "手動決済",
        "histReason_other": "その他",
    },
}

ORDER = [
    "historyTitle", "historyNote", "histClosed", "histEntryExit", "histResult",
    "histDuration", "histReason", "avgDurWin", "avgDurLoss", "durH", "durM",
    "histReason_tp", "histReason_sl", "histReason_trail", "histReason_flip",
    "histReason_manual", "histReason_other",
]

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

def line(key: str, val: str) -> str:
    return f'    {key}: "{esc(val)}",'

base = "/home/z/my-project/src/i18n/messages"
failed = False
for loc in ["en", "id", "zh", "es", "pt", "ja"]:
    path = f"{base}/{loc}.ts"
    with open(path, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src, n = re.subn(
        r'^    ocoHint: ".*",$',
        lambda m: m.group(0) + "\n" + "\n".join(line(k, BOT_NEW[loc][k]) for k in ORDER),
        src, count=1, flags=re.M,
    )
    if n != 1 or src == orig:
        print(f"[FAIL] {loc}: ocoHint anchor={n}")
        failed = True
        continue
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] {loc}")

sys.exit(1 if failed else 0)
