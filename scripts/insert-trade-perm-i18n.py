# -*- coding: utf-8 -*-
"""Task 17 i18n — trade-permission keys in 6 locales (en/id/zh/es/pt/ja).

Inserts:
  exchanges: permGranted, permDenied, permUnverified, tradeHintBitget
  bot:       liveConnOk, liveConnReadonly, liveConnUnknown, liveConnNone,
             liveWalletApiErr, liveConnReadonlyHint, liveConnNoneHint
Replaces (accuracy — live trading is now a real feature):
  exchanges: securityBody, howToBitget
"""
import re, sys

EX_NEW = {
    "en": {
        "permGranted": "Spot trade OK",
        "permDenied": "Read-only",
        "permUnverified": "Trade?",
        "tradeHintBitget": "To let the live bot place real spot orders, this key needs BOTH \u201cRead-Only\u201d AND \u201cTrade\u201d permissions on Bitget (withdrawals stay off). Balance sync works with Read-Only alone; without Trade the connection still shows balances but every order will be rejected. CryptoPulse never requests withdrawal rights.",
        "securityBody": "Credentials are encrypted with AES-256-GCM and never shown or returned again. Withdrawal permission is never used \u2014 a connected key can read balances and, only if you grant Trade rights, let the live bot place spot orders.",
        "howToBitget": "Bitget \u2192 Avatar \u2192 API keys \u2192 Create API \u2192 enable \u201cRead-Only\u201d AND \u201cTrade\u201d, set a passphrase, leave withdrawals off and do NOT set an IP whitelist (the app runs on cloud servers with changing IPs).",
    },
    "id": {
        "permGranted": "Trade spot OK",
        "permDenied": "Baca saja",
        "permUnverified": "Trade?",
        "tradeHintBitget": "Agar bot live dapat memasang order spot nyata, kunci ini butuh izin \u201cRead-Only\u201d DAN \u201cTrade\u201d sekaligus di Bitget (penarikan tetap nonaktif). Sinkron saldo cukup dengan Read-Only; tanpa Trade, koneksi tetap menampilkan saldo tetapi setiap order akan ditolak. CryptoPulse tidak pernah meminta hak penarikan dana.",
        "securityBody": "Kredensial dienkripsi dengan AES-256-GCM dan tidak pernah ditampilkan atau dikirim kembali. Izin penarikan tidak pernah dipakai \u2014 kunci yang terhubung dapat membaca saldo dan, hanya jika Anda memberi izin Trade, membiarkan bot live memasang order spot.",
        "howToBitget": "Bitget \u2192 Avatar \u2192 Kunci API \u2192 Buat API \u2192 aktifkan \u201cRead-Only\u201d dan \u201cTrade\u201d, atur passphrase, biarkan penarikan nonaktif, dan JANGAN mengisi whitelist IP (aplikasi berjalan di server cloud dengan IP yang berubah-ubah).",
    },
    "zh": {
        "permGranted": "现货交易已开通",
        "permDenied": "只读",
        "permUnverified": "交易权限未验证",
        "tradeHintBitget": "要让实盘机器人下真实的现货订单，这把密钥需要在 Bitget 同时勾选\u201c只读\u201d和\u201c交易\u201d权限（不要开启提现）。仅\u201c只读\u201d也能同步余额；没有\u201c交易\u201d权限时仍会显示余额，但所有订单都会被拒绝。CryptoPulse 绝不申请提现权限。",
        "securityBody": "凭据使用 AES-256-GCM 加密，之后绝不显示或返回。绝不使用提现权限——已连接的密钥可以读取余额，并且只有在你授予\u201c交易\u201d权限后，才会让实盘机器人下现货订单。",
        "howToBitget": "Bitget \u2192 头像 \u2192 API 密钥 \u2192 创建 API \u2192 同时勾选\u201c只读\u201d和\u201c交易\u201d，设置 passphrase，关闭提现，并且不要填写 IP 白名单（应用运行在 IP 会变化的云服务器上）。",
    },
    "es": {
        "permGranted": "Operativa spot OK",
        "permDenied": "Solo lectura",
        "permUnverified": "\u00bfTrade?",
        "tradeHintBitget": "Para que el bot en vivo coloque \u00f3rdenes spot reales, esta clave necesita los permisos \u201cRead-Only\u201d Y \u201cTrade\u201d en Bitget (los retiros siguen desactivados). La sincronizaci\u00f3n de saldos funciona solo con lectura; sin Trade, la conexi\u00f3n muestra saldos pero cada orden ser\u00e1 rechazada. CryptoPulse nunca solicita derechos de retiro.",
        "securityBody": "Las credenciales se cifran con AES-256-GCM y nunca se muestran ni se devuelven. El permiso de retiro nunca se usa: una clave conectada puede leer saldos y, solo si otorgas permisos de Trade, permitir que el bot en vivo coloque \u00f3rdenes spot.",
        "howToBitget": "Bitget \u2192 Avatar \u2192 Claves API \u2192 Crear API \u2192 activa \u201cRead-Only\u201d y \u201cTrade\u201d, define una passphrase, deja los retiros apagados y NO configures una lista blanca de IP (la app corre en servidores cloud con IP cambiantes).",
    },
    "pt": {
        "permGranted": "Spot trading OK",
        "permDenied": "Somente leitura",
        "permUnverified": "Trade?",
        "tradeHintBitget": "Para o bot ao vivo enviar ordens spot reais, esta chave precisa das permiss\u00f5es \u201cRead-Only\u201d E \u201cTrade\u201d na Bitget (saques permanecem desligados). A sincroniza\u00e7\u00e3o de saldos funciona s\u00f3 com leitura; sem Trade, a conex\u00e3o mostra saldos, mas toda ordem ser\u00e1 rejeitada. A CryptoPulse nunca pede direitos de saque.",
        "securityBody": "As credenciais s\u00e3o criptografadas com AES-256-GCM e nunca mais s\u00e3o exibidas ou devolvidas. A permiss\u00e3o de saque nunca \u00e9 usada \u2014 uma chave conectada pode ler saldos e, somente se voc\u00ea conceder permiss\u00e3o de Trade, deixar o bot ao vivo enviar ordens spot.",
        "howToBitget": "Bitget \u2192 Avatar \u2192 Chaves de API \u2192 Criar API \u2192 ative \u201cRead-Only\u201d e \u201cTrade\u201d, defina uma passphrase, deixe os saques desligados e N\u00c3O configure uma allowlist de IP (o app roda em servidores cloud com IPs vari\u00e1veis).",
    },
    "ja": {
        "permGranted": "現物取引OK",
        "permDenied": "読み取り専用",
        "permUnverified": "取引未確認",
        "tradeHintBitget": "ライブボットに実際のスポット注文を出させるには、このキーに Bitget で「Read-Only」と「Trade」の両方の権限が必要です（出金は無効のまま）。残高同期は読み取りだけでも動きますが、Trade が無いと残高は表示されても注文はすべて拒否されます。CryptoPulse が出金権限を要求することはありません。",
        "securityBody": "認証情報は AES-256-GCM で暗号化され、以後表示・返却されることはありません。出金権限は一切使用しません。接続したキーは残高の読み取りができ、Trade 権限を付与した場合に限りライブボットがスポット注文を出せます。",
        "howToBitget": "Bitget \u2192 アバター \u2192 API キー \u2192 Create API \u2192 「Read-Only」と「Trade」を有効化し、passphrase を設定、出金は無効のまま、IP ホワイトリストは設定しないでください（アプリは IP が変わるクラウドサーバーで動作しています）。",
    },
}

BOT_NEW = {
    "en": {
        "liveConnOk": "Bitget spot trade connected",
        "liveConnReadonly": "Key is read-only — orders blocked",
        "liveConnUnknown": "Connected — trade permission unverified",
        "liveConnNone": "Bitget not connected",
        "liveWalletApiErr": "Connected but the balance call failed — press Sync in Portfolio → Exchange connections",
        "liveConnReadonlyHint": "This API key cannot place orders: on Bitget edit the key and enable the \u201cTrade\u201d permission (spot), then press Sync here to re-verify.",
        "liveConnNoneHint": "No Bitget API key is connected. Go to Portfolio \u2192 Exchange connections \u2192 Connect \u2192 Bitget and paste the API key, secret and passphrase — the SAME connection powers balance sync and live trading.",
    },
    "id": {
        "liveConnOk": "Bitget spot trade terhubung",
        "liveConnReadonly": "Key baca saja — order diblokir",
        "liveConnUnknown": "Terhubung — izin trade belum terverifikasi",
        "liveConnNone": "Bitget belum terhubung",
        "liveWalletApiErr": "Terhubung tetapi panggilan saldo gagal — tekan Sync di Portofolio \u2192 Koneksi exchange",
        "liveConnReadonlyHint": "Kunci API ini tidak dapat memasang order: di Bitget, sunting kunci dan aktifkan izin \u201cTrade\u201d (spot), lalu tekan Sync di sini untuk verifikasi ulang.",
        "liveConnNoneHint": "Belum ada kunci API Bitget yang terhubung. Buka Portofolio \u2192 Koneksi exchange \u2192 Hubungkan \u2192 Bitget, lalu tempel API key, secret, dan passphrase — koneksi yang SAMA dipakai untuk sinkron saldo dan trading live.",
    },
    "zh": {
        "liveConnOk": "Bitget 现货交易已连接",
        "liveConnReadonly": "密钥只读 — 无法下单",
        "liveConnUnknown": "已连接 — 交易权限未验证",
        "liveConnNone": "Bitget 未连接",
        "liveWalletApiErr": "已连接但余额调用失败 — 请在\u201c投资组合 → 交易所连接\u201d按同步",
        "liveConnReadonlyHint": "这把 API 密钥无法下单：请在 Bitget 编辑该密钥并启用\u201c交易\u201d（现货）权限，然后在此按同步重新验证。",
        "liveConnNoneHint": "尚未连接 Bitget API 密钥。前往\u201c投资组合 → 交易所连接 → 连接 → Bitget\u201d，粘贴 API key、secret 和 passphrase——同一个连接同时用于余额同步和实盘交易。",
    },
    "es": {
        "liveConnOk": "Bitget spot trade conectado",
        "liveConnReadonly": "Clave de solo lectura — órdenes bloqueadas",
        "liveConnUnknown": "Conectado — permiso de trade sin verificar",
        "liveConnNone": "Bitget sin conectar",
        "liveWalletApiErr": "Conectado pero la llamada de saldo falló — pulsa Sincronizar en Portafolio → Conexiones de exchange",
        "liveConnReadonlyHint": "Esta clave API no puede colocar órdenes: en Bitget edita la clave y activa el permiso \u201cTrade\u201d (spot), luego pulsa Sincronizar aquí para reverificar.",
        "liveConnNoneHint": "No hay ninguna clave API de Bitget conectada. Ve a Portafolio → Conexiones de exchange → Conectar → Bitget y pega la clave API, el secret y la passphrase: la MISMA conexión gestiona la sincronización de saldos y el trading en vivo.",
    },
    "pt": {
        "liveConnOk": "Bitget spot trade conectado",
        "liveConnReadonly": "Chave somente leitura — ordens bloqueadas",
        "liveConnUnknown": "Conectado — permissão de trade não verificada",
        "liveConnNone": "Bitget não conectado",
        "liveWalletApiErr": "Conectado, mas a chamada de saldo falhou — pressione Sincronizar em Portfólio → Conexões de exchange",
        "liveConnReadonlyHint": "Esta chave de API não pode enviar ordens: na Bitget, edite a chave e ative a permissão \u201cTrade\u201d (spot), depois pressione Sincronizar aqui para reverificar.",
        "liveConnNoneHint": "Nenhuma chave de API da Bitget está conectada. Vá a Portfólio → Conexões de exchange → Conectar → Bitget e cole a chave de API, o secret e a passphrase — a MESMA conexão alimenta a sincronização de saldos e o trading ao vivo.",
    },
    "ja": {
        "liveConnOk": "Bitget スポット取引に接続済み",
        "liveConnReadonly": "キーは読み取り専用 — 注文不可",
        "liveConnUnknown": "接続済み — 取引権限は未確認",
        "liveConnNone": "Bitget 未接続",
        "liveWalletApiErr": "接続済みですが残高取得に失敗 — ポートフォリオ → 取引所接続で同期を押してください",
        "liveConnReadonlyHint": "この API キーでは注文を出せません：Bitget でキーを編集し「Trade」（スポット）権限を有効にしてから、ここで同期を押して再確認してください。",
        "liveConnNoneHint": "Bitget の API キーが未接続です。ポートフォリオ → 取引所接続 → 接続 → Bitget から API キー・シークレット・passphrase を貼り付けてください。残高同期とライブ取引は同じ接続を使います。",
    },
}

ORDER_EX_AFTER = ["permGranted", "permDenied", "permUnverified", "tradeHintBitget"]
ORDER_BOT = ["liveConnOk", "liveConnReadonly", "liveConnUnknown", "liveConnNone", "liveWalletApiErr", "liveConnReadonlyHint", "liveConnNoneHint"]

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

def line(key: str, val: str, indent: str = "    ") -> str:
    return f'{indent}{key}: "{esc(val)}",\n'

base = "/home/z/my-project/src/i18n/messages"
failed = False
for loc in ["en", "id", "zh", "es", "pt", "ja"]:
    path = f"{base}/{loc}.ts"
    with open(path, encoding="utf-8") as f:
        src = f.read()
    orig = src

    # exchanges: replace securityBody + howToBitget lines, then append new keys after howToBitget
    src, n1 = re.subn(r'^    securityBody: ".*",$', lambda m: line("securityBody", EX_NEW[loc]["securityBody"]).rstrip("\n"), src, count=1, flags=re.M)
    src, n2 = re.subn(
        r'^    howToBitget: ".*",$',
        lambda m: line("howToBitget", EX_NEW[loc]["howToBitget"]).rstrip("\n") + "\n" + "".join(line(k, EX_NEW[loc][k]) for k in ORDER_EX_AFTER).rstrip("\n"),
        src, count=1, flags=re.M,
    )
    # bot: append new keys after liveWalletNoConn
    src, n3 = re.subn(
        r'^    liveWalletNoConn: ".*",$',
        lambda m: m.group(0) + "\n" + "".join(line(k, BOT_NEW[loc][k]) for k in ORDER_BOT).rstrip("\n"),
        src, count=1, flags=re.M,
    )
    if not (n1 == n2 == n3 == 1):
        print(f"[FAIL] {loc}: securityBody={n1} howToBitget={n2} liveWalletNoConn={n3}")
        failed = True
        continue
    if src == orig:
        print(f"[WARN] {loc}: no change?")
        failed = True
        continue
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] {loc}")

sys.exit(1 if failed else 0)
