#!/usr/bin/env python3
"""Insert paper-wallet i18n keys right after the pfJumpTo line in each locale."""
import re, sys

BASE = "/home/z/my-project/src/i18n/messages"
BLOCKS = {
    "en": [
        '    walletTitle: "Paper wallet",',
        '    walletCapital: "Capital",',
        '    walletEquity: "Balance now",',
        '    walletPnl: "P/L vs capital",',
        '    walletFloat: "open {v} $",',
        '    walletUsed: "In positions {v} $",',
        '    walletFree: "Free {v} $",',
        '    walletRealized: "Realized {v} $",',
        '    walletNoMark: "live price unavailable",',
        '    modalField: "Paper capital (USDT)",',
        '    modalHint: "Starting wallet for this simulated bot. Entries are capped by the free balance = capital + P/L - open positions.",',
        '    pfWallet: "Capital → balance (paper bots)",',
        '    upnl: "Open P/L",',
    ],
    "id": [
        '    walletTitle: "Dompet paper",',
        '    walletCapital: "Modal",',
        '    walletEquity: "Saldo sekarang",',
        '    walletPnl: "P/L dari modal",',
        '    walletFloat: "mengambang {v} $",',
        '    walletUsed: "Di posisi {v} $",',
        '    walletFree: "Bebas {v} $",',
        '    walletRealized: "Terealisasi {v} $",',
        '    walletNoMark: "harga live tak tersedia",',
        '    modalField: "Modal paper (USDT)",',
        '    modalHint: "Modal awal dompet simulasi bot ini. Entry dibatasi saldo bebas = modal + P/L - posisi terbuka.",',
        '    pfWallet: "Modal → saldo (bot paper)",',
        '    upnl: "P/L terbuka",',
    ],
    "zh": [
        '    walletTitle: "模拟钱包",',
        '    walletCapital: "本金",',
        '    walletEquity: "当前余额",',
        '    walletPnl: "相对本金的盈亏",',
        '    walletFloat: "浮动 {v} $",',
        '    walletUsed: "持仓占用 {v} $",',
        '    walletFree: "可用 {v} $",',
        '    walletRealized: "已实现 {v} $",',
        '    walletNoMark: "实时价格不可用",',
        '    modalField: "模拟本金 (USDT)",',
        '    modalHint: "该模拟机器人的起始资金。开仓受可用余额限制 = 本金 + 盈亏 - 持仓占用。",',
        '    pfWallet: "本金 → 余额（模拟机器人）",',
        '    upnl: "持仓盈亏",',
    ],
    "es": [
        '    walletTitle: "Cartera simulada",',
        '    walletCapital: "Capital",',
        '    walletEquity: "Saldo actual",',
        '    walletPnl: "P/G sobre capital",',
        '    walletFloat: "flotante {v} $",',
        '    walletUsed: "En posiciones {v} $",',
        '    walletFree: "Libre {v} $",',
        '    walletRealized: "Realizado {v} $",',
        '    walletNoMark: "precio live no disponible",',
        '    modalField: "Capital simulado (USDT)",',
        '    modalHint: "Fondo inicial de este bot simulado. Las entradas se limitan al saldo libre = capital + P/G - posiciones abiertas.",',
        '    pfWallet: "Capital → saldo (bots simulados)",',
        '    upnl: "P/G abierto",',
    ],
    "pt": [
        '    walletTitle: "Carteira simulada",',
        '    walletCapital: "Capital",',
        '    walletEquity: "Saldo atual",',
        '    walletPnl: "L/P sobre o capital",',
        '    walletFloat: "flutuante {v} $",',
        '    walletUsed: "Em posições {v} $",',
        '    walletFree: "Livre {v} $",',
        '    walletRealized: "Realizado {v} $",',
        '    walletNoMark: "preço live indisponível",',
        '    modalField: "Capital simulado (USDT)",',
        '    modalHint: "Fundo inicial deste bot simulado. As entradas são limitadas ao saldo livre = capital + L/P - posições abertas.",',
        '    pfWallet: "Capital → saldo (bots simulados)",',
        '    upnl: "L/P aberta",',
    ],
    "ja": [
        '    walletTitle: "ペーパーウォレット",',
        '    walletCapital: "元本",',
        '    walletEquity: "現在の残高",',
        '    walletPnl: "元本に対する損益",',
        '    walletFloat: "含み損益 {v} $",',
        '    walletUsed: "ポジション中 {v} $",',
        '    walletFree: "余力 {v} $",',
        '    walletRealized: "確定損益 {v} $",',
        '    walletNoMark: "ライブ価格を取得できません",',
        '    modalField: "ペーパー元本 (USDT)",',
        '    modalHint: "このシミュレーションボットの初期資金。新規買いは余力（元本＋損益－建玉）の範囲内です。",',
        '    pfWallet: "元本 → 残高（ペーパーボット）",',
        '    upnl: "含み損益",',
    ],
}

failed = False
for loc, lines in BLOCKS.items():
    path = f"{BASE}/{loc}.ts"
    src = open(path, encoding="utf-8").read()
    if "walletTitle" in src:
        print(f"[skip] {loc}: keys already present")
        continue
    pat = re.compile(r'^(    pfJumpTo: .*)$', re.M)
    m = pat.search(src)
    if not m:
        print(f"[FAIL] {loc}: pfJumpTo anchor not found")
        failed = True
        continue
    ins = "\n".join(lines)
    out = src[:m.end()] + "\n" + ins + src[m.end():]
    open(path, "w", encoding="utf-8").write(out)
    print(f"[ok] {loc}: 13 keys inserted")

sys.exit(1 if failed else 0)
