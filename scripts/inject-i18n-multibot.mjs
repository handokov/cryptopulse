/**
 * Task 30 — inject multi-bot + login-gating i18n keys into all 6 languages.
 * - new `dashboard` namespace before `bot: {`
 * - new bot.* keys after the `exit_trail_stop` line
 * Idempotent: skips a file if the anchor key already exists.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DIR = new URL("../src/i18n/messages/", import.meta.url).pathname;

const DASH = {
  id: ["Khusus anggota", "Masuk untuk membuka dasbor portofolio dan bot trading Anda — datanya privat per akun.", "Masuk / Buat akun"],
  en: ["Members only", "Sign in to open your portfolio and trading-bot dashboard — your data stays private per account.", "Sign in / Create account"],
  es: ["Solo para miembros", "Inicia sesión para abrir tu panel de portafolio y bot de trading — tus datos son privados por cuenta.", "Iniciar sesión / Crear cuenta"],
  pt: ["Somente membros", "Entre para abrir seu painel de portfólio e bot de negociação — seus dados ficam privados por conta.", "Entrar / Criar conta"],
  ja: ["メンバー限定", "ポートフォリオと取引ボットのダッシュボードはログイン後に利用できます。データはアカウントごとに非公開です。", "ログイン / アカウント作成"],
  zh: ["会员专享", "登录后才能打开你的投资组合与交易机器人面板 — 数据按账号私密保存。", "登录 / 注册"],
};

const BOT = {
  id: {
    addBot: "Bot baru",
    quotaLabel: "Paper {paper}/{maxPaper} · Live {live}/{maxLive}",
    newBotHint: "Bot baru — isi simbol (contoh: BTCUSDT), atur, lalu Simpan.",
    needSymbol: "Simbol harus berformat COINUSDT, contoh BTCUSDT.",
    deleteBot: "Hapus bot",
    deleteTitle: "Hapus bot {symbol}?",
    deleteBody: "Seluruh riwayat transaksi bot ini ikut terhapus permanen. Bot yang masih punya posisi terbuka tidak bisa dihapus.",
    deleteAction: "Hapus",
    cancel: "Batal",
    deleted: "Bot {symbol} dihapus",
    deleteBlocked: "Masih ada posisi terbuka — bot tidak bisa dihapus",
    symbolExists: "Simbol itu sudah punya bot sendiri",
    quotaPaper: "Kuota bot paper penuh (maks {max})",
    quotaLive: "Kuota bot live penuh (maks {max})",
  },
  en: {
    addBot: "New bot",
    quotaLabel: "Paper {paper}/{maxPaper} · Live {live}/{maxLive}",
    newBotHint: "New bot — enter a symbol (e.g. BTCUSDT), configure, then Save.",
    needSymbol: "Symbol must look like COINUSDT, e.g. BTCUSDT.",
    deleteBot: "Delete bot",
    deleteTitle: "Delete bot {symbol}?",
    deleteBody: "This permanently removes the bot's entire trade history. Bots with an open position cannot be deleted.",
    deleteAction: "Delete",
    cancel: "Cancel",
    deleted: "Bot {symbol} deleted",
    deleteBlocked: "Still has an open position — the bot cannot be deleted",
    symbolExists: "That symbol already has its own bot",
    quotaPaper: "Paper bot quota full (max {max})",
    quotaLive: "Live bot quota full (max {max})",
  },
  es: {
    addBot: "Nuevo bot",
    quotaLabel: "Paper {paper}/{maxPaper} · Live {live}/{maxLive}",
    newBotHint: "Bot nuevo — escribe un símbolo (p. ej. BTCUSDT), configúralo y guarda.",
    needSymbol: "El símbolo debe tener el formato COINUSDT, p. ej. BTCUSDT.",
    deleteBot: "Eliminar bot",
    deleteTitle: "¿Eliminar el bot {symbol}?",
    deleteBody: "Se elimina permanentemente todo el historial de operaciones del bot. Un bot con posición abierta no se puede eliminar.",
    deleteAction: "Eliminar",
    cancel: "Cancelar",
    deleted: "Bot {symbol} eliminado",
    deleteBlocked: "Aún tiene una posición abierta — no se puede eliminar",
    symbolExists: "Ese símbolo ya tiene su propio bot",
    quotaPaper: "Cuota de bots paper llena (máx. {max})",
    quotaLive: "Cuota de bots live llena (máx. {max})",
  },
  pt: {
    addBot: "Novo bot",
    quotaLabel: "Paper {paper}/{maxPaper} · Live {live}/{maxLive}",
    newBotHint: "Novo bot — digite um símbolo (ex.: BTCUSDT), configure e salve.",
    needSymbol: "O símbolo deve estar no formato COINUSDT, ex.: BTCUSDT.",
    deleteBot: "Excluir bot",
    deleteTitle: "Excluir o bot {symbol}?",
    deleteBody: "Todo o histórico de negociações deste bot será excluído permanentemente. Bots com posição aberta não podem ser excluídos.",
    deleteAction: "Excluir",
    cancel: "Cancelar",
    deleted: "Bot {symbol} excluído",
    deleteBlocked: "Ainda há posição aberta — o bot não pode ser excluído",
    symbolExists: "Esse símbolo já tem seu próprio bot",
    quotaPaper: "Cota de bots paper cheia (máx. {max})",
    quotaLive: "Cota de bots live cheia (máx. {max})",
  },
  ja: {
    addBot: "新しいボット",
    quotaLabel: "Paper {paper}/{maxPaper} · Live {live}/{maxLive}",
    newBotHint: "新しいボット — シンボル（例：BTCUSDT）を入力して設定し、保存してください。",
    needSymbol: "シンボルは COINUSDT 形式で入力してください（例：BTCUSDT）。",
    deleteBot: "ボットを削除",
    deleteTitle: "ボット {symbol} を削除しますか？",
    deleteBody: "このボットの全取引履歴が完全に削除されます。ポジションが開いているボットは削除できません。",
    deleteAction: "削除",
    cancel: "キャンセル",
    deleted: "ボット {symbol} を削除しました",
    deleteBlocked: "ポジションが開いているため削除できません",
    symbolExists: "そのシンボルのボットはすでに存在します",
    quotaPaper: "ペーパーボットの上限に達しました（最大 {max}）",
    quotaLive: "ライブボットの上限に達しました（最大 {max}）",
  },
  zh: {
    addBot: "新建机器人",
    quotaLabel: "模拟 {paper}/{maxPaper} · 实盘 {live}/{maxLive}",
    newBotHint: "新机器人 — 输入交易对（如 BTCUSDT），设置后保存。",
    needSymbol: "交易对格式需为 COINUSDT，例如 BTCUSDT。",
    deleteBot: "删除机器人",
    deleteTitle: "删除机器人 {symbol}？",
    deleteBody: "将永久删除该机器人的全部交易记录。仍有持仓的机器人无法删除。",
    deleteAction: "删除",
    cancel: "取消",
    deleted: "机器人 {symbol} 已删除",
    deleteBlocked: "仍有未平仓持仓 — 无法删除",
    symbolExists: "该交易对已有自己的机器人",
    quotaPaper: "模拟机器人配额已满（最多 {max}）",
    quotaLive: "实盘机器人配额已满（最多 {max}）",
  },
};

const fmtBot = (m) =>
  Object.entries(m)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`)
    .join("\n");

const fmtDash = (a) =>
  `  dashboard: {\n    lockedTitle: ${JSON.stringify(a[0])},\n    lockedBody: ${JSON.stringify(a[1])},\n    lockedCta: ${JSON.stringify(a[2])},\n  },\n`;

for (const [lang, bot] of Object.entries(BOT)) {
  const path = `${DIR}${lang}.ts`;
  let src = readFileSync(path, "utf8");
  let changed = false;

  if (!src.includes("dashboard: {")) {
    const anchor = "  bot: {";
    if (!src.includes(anchor)) throw new Error(`${lang}: bot anchor missing`);
    src = src.replace(anchor, `${fmtDash(DASH[lang])}\n${anchor}`);
    changed = true;
  }

  if (!src.includes("addBot:")) {
    const lines = src.split("\n");
    const i = lines.findIndex((l) => l.includes("exit_trail_stop:"));
    if (i === -1) throw new Error(`${lang}: exit_trail_stop anchor missing`);
    // append a comma if the anchor line lacks one (it may end the block in some files)
    if (!lines[i].trimEnd().endsWith(",")) lines[i] = `${lines[i].trimEnd()},`;
    lines.splice(i + 1, 0, fmtBot(bot));
    src = lines.join("\n");
    changed = true;
  }

  if (changed) {
    writeFileSync(path, src);
    console.log(`${lang}.ts updated`);
  } else {
    console.log(`${lang}.ts already up to date`);
  }
}
