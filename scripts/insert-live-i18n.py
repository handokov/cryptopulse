#!/usr/bin/env python3
# Task 16 — insert Bitget-real (live limit + OCO) i18n keys into the bot
# namespace of all 6 locale files, right after the existing `walletPending`
# key. Idempotent: skips locales that already carry `liveWalletTitle`.
import re
import sys

BASE = "/home/z/my-project/src/i18n/messages"

BLOCKS = {
    "en": [
        'liveWalletTitle: "LIVE WALLET · Bitget spot",',
        'liveWalletAvail: "Available USDT",',
        'liveWalletOpen: "In positions",',
        'liveWalletNote: "Funding comes from your real Bitget spot balance. Entry is a post-only limit BELOW the market that carries its own OCO (TP/SL) the moment it fills.",',
        'liveWalletNoConn: "Bitget API not connected or unreachable — live entries are paused",',
        'pendingOrderId: "order {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "TP/SL armed on Bitget — the exchange exits automatically (one cancels the other)",',
    ],
    "id": [
        'liveWalletTitle: "DOMPET LIVE · spot Bitget",',
        'liveWalletAvail: "Saldo USDT tersedia",',
        'liveWalletOpen: "Dalam posisi",',
        'liveWalletNote: "Modal diambil dari saldo spot Bitget Anda. Entry berupa limit post-only DI BAWAH pasar yang membawa OCO sendiri (TP/SL) begitu terisi.",',
        'liveWalletNoConn: "API Bitget tidak terhubung / tidak dapat dijangkau — entry live dijeda",',
        'pendingOrderId: "order {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "TP/SL terpasang di Bitget — bursa yang mengeksekusi otomatis (satu membatalkan yang lain)",',
    ],
    "zh": [
        'liveWalletTitle: "实盘钱包 · Bitget 现货",',
        'liveWalletAvail: "可用 USDT",',
        'liveWalletOpen: "持仓占用",',
        'liveWalletNote: "资金直接来自您的 Bitget 现货余额。入场为低于市价的只挂单限价单，成交瞬间自带 OCO（止盈/止损）。",',
        'liveWalletNoConn: "Bitget API 未连接或不可达——实盘入场已暂停",',
        'pendingOrderId: "订单 {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "止盈/止损已挂在 Bitget——由交易所自动执行（一方成交即撤销另一方）",',
    ],
    "es": [
        'liveWalletTitle: "CARTERA REAL · spot de Bitget",',
        'liveWalletAvail: "USDT disponible",',
        'liveWalletOpen: "En posiciones",',
        'liveWalletNote: "La financiación proviene de tu saldo real de spot en Bitget. La entrada es una orden límite post-only POR DEBAJO del mercado con su propio OCO (TP/SL) al ejecutarse.",',
        'liveWalletNoConn: "API de Bitget no conectada o inaccesible — entradas en vivo en pausa",',
        'pendingOrderId: "orden {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "TP/SL armado en Bitget — el exchange sale automáticamente (uno cancela al otro)",',
    ],
    "pt": [
        'liveWalletTitle: "CARTEIRA REAL · spot da Bitget",',
        'liveWalletAvail: "USDT disponível",',
        'liveWalletOpen: "Em posições",',
        'liveWalletNote: "O financiamento vem do seu saldo real de spot na Bitget. A entrada é uma ordem limite post-only ABAIXO do mercado que traz o próprio OCO (TP/SL) ao ser preenchida.",',
        'liveWalletNoConn: "API da Bitget não conectada ou inacessível — entradas reais pausadas",',
        'pendingOrderId: "ordem {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "TP/SL armado na Bitget — a exchange sai automaticamente (um cancela o outro)",',
    ],
    "ja": [
        'liveWalletTitle: "ライブウォレット · Bitget スポット",',
        'liveWalletAvail: "利用可能な USDT",',
        'liveWalletOpen: "ポジション中",',
        'liveWalletNote: "資金は Bitget スポットの実際の残高から供給されます。エントリーは市価より低い post-only 指値で、約定と同時に OCO（TP/SL）が自動で付きます。",',
        'liveWalletNoConn: "Bitget API に接続できないため、ライブエントリーは一時停止中",',
        'pendingOrderId: "注文 {id}",',
        'ocoBadge: "OCO",',
        'ocoHint: "TP/SL は Bitget 側に設置済み — 取引所が自動で決済します（片方成立でもう片方を取消）",',
    ],
}

INDENT = "    "


def main() -> int:
    failures = []
    for loc, keys in BLOCKS.items():
        path = f"{BASE}/{loc}.ts"
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
        if any("liveWalletTitle" in ln for ln in lines):
            print(f"{loc}: already present — skipped")
            continue
        anchor_idx = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith("walletPending:")), None)
        if anchor_idx is None:
            failures.append(f"{loc}: walletPending anchor not found")
            continue
        # find the end of the walletPending line (it may span lines) — anchor
        # entries are single-line in every locale (verified for this key)
        insert_at = anchor_idx + 1
        block = [INDENT + k + "\n" for k in keys]
        lines[insert_at:insert_at] = block
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        print(f"{loc}: inserted {len(keys)} keys after line {anchor_idx + 1}")
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
