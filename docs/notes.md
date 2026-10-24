# ノート

[openline](../README.md) を触って分かった LINE API/プロトコルの仕様・制約・セキュリティまわりのまとめ。

## 1. 検証済み制約

### Flex Message は個人アカウントから送信できない

- `talk.sendMessage({contentType: "FLEX", contentMetadata: {FLEX_VER, FLEX_JSON, ALT_TEXT}, e2ee: false})` を叩くと LINE サーバーが `INCOMPATIBLE_APP_VERSION` で拒否
- DEVICE=DESKTOPWIN / IOSIPAD どちらでも結果同じ
- Flex Message は Messaging API（Bot / 公式アカウント）専用。個人は受信のみ

→ [src/write/send-flex.ts](../src/write/send-flex.ts) は参考実装として残しているがサーバーで弾かれる

### 位置情報は相手の E2EE 設定で変わる

- 相手が LetterSealing を有効にしている 1:1 トークでは、`e2ee: false` で送ると `E2EE_RETRY_ENCRYPT` エラー
- 既定で E2EE オン（`ENC=0` で明示的に平文化）
- グループは参加者全員の鍵共有が成立してれば E2EE 可能

### `client.listen()` (push) は実機スマホと競合する

- linejs の `listen()` は fetchOps 系の long-polling + LEGY HTTP/2 push
- 同じ auth で実機スマホ側 LINE が動いていると revision を奪い合い、daemon 側に push が流れないケースがある
- 対策: [src/read/inbox.ts](../src/read/inbox.ts) はポーリング方式（15秒間隔で `getMessageBoxes(unreadOnly=true)` を叩き diff を取る）に切替

### サーバー履歴の保存期間

- LINE はクライアント（スマホ）側がプライマリ、サーバーは数ヶ月〜1〜2年の肌感
- 長期間非アクティブなトーク相手は `getMessageBoxes` の直近200件アクティブリストにも入らず、`getPreviousMessagesV2` で 0 件返る
- 「5年前のトーク」はまず無理。スマホ本体バックアップが唯一の経路

### `getMessageBoxes` の落とし穴

- `messageBoxListRequest` に `minChatId` / `maxChatId` を空文字で渡すと 0 件返る → 省略が正解

### QR ログイン endpoint は不安定

- 旧 QR 検証エンドポイントが HTTP 410 を返すことがある
- linejs の内部で retry 上限が 1 なので失敗しやすい（過去対応: retry 回数を 20 に上げるパッチ）

## 2. 位置情報メッセージで実際に送られる項目

protocol (thrift) 定義の全フィールド:

| フィールド | 由来 | UI で見える？ |
|---|---|---|
| `title` | ユーザー入力 or 候補POI選択 | ○ |
| `address` | LINE/Googleのジオコーダ由来 | ○ |
| `latitude` / `longitude` | 端末 GPS or POI 座標 | ○（マップで） |
| `phone` | POI 選択時のみ | ○ |
| `categoryId` | POI カテゴリ | △ |
| `provider` | POI DB の出所 | ✕ |
| `accuracy.radiusMeters` | GPS 精度半径 | ✕ |
| `accuracy.radiusConfidence` | GPS 信頼度 | ✕ |
| `accuracy.altitudeAccuracy` | 高度精度 | ✕ |
| `accuracy.velocityAccuracy` | 速度精度 | ✕ |
| `altitudeMeters` | 高度 | ✕ |

公式アプリの「現在地を送る」は OS GPS を叩いて `lat/lng/accuracy/altitude` 全部埋める。UI には出ない精度半径・高度まで裏で送信される。

## 3. 受信メッセージからも全部読める

inbox.ts の `message` ハンドラで `msg.raw.location` を見ると、送った相手が無意識に乗せている精度半径・高度まで全部取れる。LINE のクライアントは UI にそれを出さないだけで、payload には乗っている。

## 4. LINE auth トークンの意味 = スマホ本体と同等の権限

`storage/*.json` に保存される `.auth` は、そのアカウントとして LINE に対してフル権限を持つ。

### できること
- 全チャットの読み書き（過去履歴の遡取、送受信）
- 友だち管理（追加・ブロック・メモ名変更・非表示）
- グループ運営（招待・キック・アナウンス・BGM）
- 自分のプロフィール（名前・画像・ステータス）更新
- ライブ位置情報が流れているトークのストリーム購読
- 他デバイスのログインセッションの一覧・revoke
- VOOM 投稿・読み取り、LIFF 起動、スタンプ購入、通話発着信

### できないこと
- **相手のスマホの現在地を remote で吸う**（LINE サーバーはユーザーの現在地を常時保持していない）
- `getCurrentLocation(mid)` のような API は存在しない
- 相手の端末 GPS を能動的に発動させる手段はない

### 間接的な特定
- 過去のトークに残っている位置情報・写真の EXIF からパターン推定
- ライブ位置情報共有を自分宛てに仕込ませる（相手に気づかれる）

## 5. なぜ LINE は乗っ取られやすいか

### 設計の歴史的経緯

- 初期は電話番号 + SMS が主要認証（パスワード無し）
- メアド+パスは後から追加されたオプション。設定していないユーザーが今も大量
- 「引き継ぎ」フローが電話番号 + SMS 認証コードで完結し、旧端末を kick する設計
- 本人確認 PIN が 4桁数字しかない
- QR ログインが「スマホ LINE で読む」だけで追加確認無しに完了する
- デバイス種別 (DESKTOPWIN / IOSIPAD / ANDROID / CHROMEOS / IOS) が多く、並列セッションの把握が難しい
- 2FA は手動オン、E2EE (LetterSealing) もオン必須ではない

### 典型的な乗っ取り経路

- SMS フィッシング: 偽の確認 SMS → フィッシングサイトでコード入力 → 引き継ぎ成立
- PIN 抜き: フィッシングで PIN + 電話番号を取り、なりすまし引き継ぎ
- QR 詐欺: 「ログインボーナス受け取り」等でフィッシング QR を読ませる
- メアド+パス流出: 他サイト漏洩のパスワード使い回しを刺される
- SIM スワップ: 通信キャリア側で番号を奪われると SMS 認証が全部通る

### 他アプリとの比較

| | LINE | Signal | WhatsApp |
|---|---|---|---|
| 標準 2FA | 無し（手動オン） | PIN 必須 | 2FA PIN 推奨 |
| E2EE | 選択制 | 全文強制 | 全文強制 |
| 乗っ取り時の警告 | 旧端末 kick | 全端末通知 | 全端末通知 |

LINE はビジネス的に「日本の非技術層ユーザー数億 UI 変えづらい」事情で古い仕様が残っている。

### 自分を守る

- メアド+強いパスワードを設定し、他サイトと使い回さない
- 設定 → アカウント → ログイン端末 を定期チェック、知らないデバイスは即 revoke
- 「他端末からのログイン許可」オフ
- 2段階認証オン、LetterSealing オン
- 知らない QR は絶対読まない、PC 画面の QR を他人に見せない
- `storage/*.json`（linejs の auth）は gitignore 必須。これが漏れた瞬間、乗っ取られたのと同じ

## 6. 運用メモ

- サブアカウント本体 LINE はエミュレーター (Pixel_8) 内に置く
- エミュ起動時 `-no-snapshot-save` 禁止（セッション破損の既往）
- 送信系 CLI は dry-run 既定、`--yes` で初めて反映
- Mac から実 GPS を取る: `brew install --cask corelocationcli` → システム設定で位置情報サービス許可 → `CoreLocationCLI -once -format "%latitude %longitude"`
- GPS が取れない場合の fallback: `curl -s http://ip-api.com/json/` で ISP ゲートウェイ由来の推定座標（市町村レベル精度）
- 逆ジオコーディング: `curl -s "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=X&lon=Y&accept-language=ja" -H "User-Agent: your-app/1.0"`

## 7. CHATEVENT 削除/隠蔽の不可能性（確定）

グループで発生する CHATEVENT（招待/キック/参加/退出/名前変更 等のシステム通知）を相手の画面から消す方法は **公開手段では存在しない**。徹底検証済み:

### 試して全部ダメだったもの

- `talk.unsendMessage(messageId)` を自分発行の CHATEVENT (C_GI 招待 / C_MR kick) に発火 → API は `OK: {}` で受理されるが、相手の LINE UI には全く反映されず依然として表示される。`contentMetadata.UPDATED_TIME` だけ更新される
- 他人発行の CHATEVENT (C_MJ 相手の join) への unsend → `ILLEGAL_ARGUMENT: not your message`
- `destroyMessage` / `deleteMessage` / `removeMessage` / `hideMessage` を TalkService `/S4` に対して直接叩き → `"Invalid method name"`（methods do not exist on talk service, Square のみ）
- `editMessage` は TalkService に **存在する**（`"invalid message: null"` / `"invalid request"` を返す = method 自体はある）が args 形式不明、恐らく通常テキスト用で CHATEVENT 編集不可
- プロフィール表示名を変更して描画キャッシュ更新 → 可能だがグローバル影響あり、Multi Profile 必要なら Premium 必須

### 構造的理由

CHATEVENT は `contentType=NONE` + `contentMetadata.LOC_KEY`（C_GI/C_MR/C_MJ 等）で表現され、クライアント側で LOC_KEY からローカライズして描画する仕組み。unsend フラグや UPDATED_TIME よりも **LOC_KEY に基づく描画が優先** されるため、サーバー API で何をしても表示が変わらない。公式アプリ UI にも「システム通知を取消す」操作は存在しない。

### editMessage の存在

- `editMessage(/S4)` は 404 ではなく thrift exception を返す = TalkService にハンドラあり
- linejs 公開 schema には無し。LYP Premium の `MESSAGE_EDIT` 機能のバックエンドと推定
- args は `sendMessage_args` 形状 / `{seq, messageId}` 形状 / 空 全部で `"invalid request"` → request wrapper + 未知フィールドが必要
- 判明させるには mitmproxy で LINE 公式アプリの editMessage トラフィック捕獲が必要（下記 "LEGY ネイティブスタック" 参照）

## 8. LEGY ネイティブスタックと mitm の壁

LINE Android app は **独自のネットワーク層** を持ち、system HTTP proxy や system OpenSSL を経由しない:

| ライブラリ | 役割 |
|---|---|
| `libssl3line.so` | OpenSSL 3.0 fork（LINE 専用）。SSL_write/SSL_read 等標準 API |
| `liblegy.so` | LEGY = LINE 独自の HTTP/2 風プロトコル |
| `libcrypto3line.so` | OpenSSL crypto fork |

LEGY は TLS の内側で **さらに LECC (Line Encrypted Client Context)** という AES 層を持つ。plaintext thrift → LECC encrypt → TLS encrypt → wire の多重暗号化。

### Frida 捕獲ポイント（検証済み）

- `liblegy.so!lec_aes_encrypt(ctx, data_in, data_in_len, data_out, ...)` — plaintext thrift が第2引数（LECC 暗号化前）
- `libssl3line.so!SSL_write(ssl, buf, len)` — LECC 暗号化済み bytes
- JNI 公開関数: `Java_jp_naver_line_android_legy_encryption_LegyHmac_lec_*`
- lazy load: liblegy/libssl3line は **ログイン後にのみプロセスに mapping される**。registration 画面段階ではまだロードされてない

### 捕獲用 Frida スニペット

```javascript
const timer = setInterval(() => {
    const legy = Process.findModuleByName('liblegy.so');
    if (legy) {
        Interceptor.attach(Module.findExportByName('liblegy.so', 'lec_aes_encrypt'), {
            onEnter(args) {
                const len = args[2].toInt32();
                const bytes = args[1].readByteArray(Math.min(len, 8192));
                // ここで thrift binary を解析
            }
        });
        clearInterval(timer);
    }
}, 500);
```

### 実運用の壁

Android emulator で LINE sub-device 認証を通すのは不可。**サーバー側で emulator を検出して network error を返す**:
- `ro.kernel.qemu=1`, `ro.build.tags=dev-keys`, `ro.build.fingerprint=emu64a` 等 OS 指紋が完全に emulator を示す
- Frida で `android.os.Build.*` と `android.os.SystemProperties.get()` を Pixel 7 偽装しても **network error が解消しない**
- 推定: LINE が **Play Integrity API の STRONG_INTEGRITY**（hardware TEE 必須）を要求してる
- 回避には **root 済み物理 Android デバイス + Magisk + Shamiko + Play Integrity Fix モジュール** が必要
- emulator のみでは原理的に不可（Google 設計上の防御）

### 結論

CHATEVENT を相手の画面から消す公開手段は存在せず、editMessage の args を解明しても CHATEVENT には適用できない見込み。**この問題はこれ以上追わない**。

## 9. LIFF 経由 `/message/v3/share` で送れるメッセージタイプ (実証)

デフォルト LIFF (`2006747340-AoraPvdD` = @evex land) 経由で個人アカから **Bot 専用タイプを含む 10 種類** が送信可能と確認。openline-test グループに実機送信して動作確認済み。

| タイプ | 動作 | 備考 |
|---|---|---|
| text | ✓ | 普通のテキスト。talk.sendMessage でも可 |
| image | ✓ | `originalContentUrl` + `previewImageUrl` を URL 指定、アップロード不要 |
| video | ✓ | URL 指定 |
| audio | ✓ | URL + `duration` ms |
| sticker | ✓ | packageId + stickerId。**自分が所有してないパックも送信成功**（例: 11537/52002734） |
| location | ✓ | title/address/latitude/longitude |
| imagemap | ✗ | `'messages' is invalid.` デフォルト LIFF の scope に含まれてない模様。自前 LIFF 登録で解決可能 |
| template (buttons) | ✓ | **Bot 専用機能**。thumbnailImageUrl + title + text + actions |
| template (confirm) | ✓ | **Bot 専用機能**。はい/いいえ ダイアログ |
| template (carousel) | ✓ | **Bot 専用機能**。複数カード横スライド |
| flex | ✓ | 既に別節で記録済み |

### 制約（LIFF share 全般）

- **action type は `uri` のみ**。`message` / `postback` / `datetimepicker` は `INVALID_MESSAGE` で拒否される（送信元が bot でないので戻り先が無い）
- **宛先は自分の mid 不可** (`INVALID_RECEIVER`)。friend mid or group mid のみ
- **rate limit** 短時間に連続送信は `RateLimit has exceeded`。2秒間隔推奨
- **消費する channel 権限**: `chat_message.write` scope (LIFF 初回使用時に consent 必須)

### CLI

- [src/write/send-liff-flex.ts](../src/write/send-liff-flex.ts): Flex 特化、preset: hello/rich/schedule
- [src/write/send-liff-all.ts](../src/write/send-liff-all.ts): 全タイプを batch 送信、`--types=` で選択可。デモ用の自分だけ入ってる空グループ(例: openline-test)に送って Keep 代わりに使うのが実用的

### 実用的な「自分へのメモ」運用

LINE Keep Memo (自分へのメッセージ) は LIFF share で宛先指定不可。代替として:
1. 自分だけメンバーの空グループを作成（`talk.createChat({type:"GROUP", name:"メモ", targetUserMids:[]})` でも作れる）
2. そのグループに send-liff-all.ts などで送信
3. 必要なら LINE 本体 UI 上で「Keep に保存」で個別移動

## 10. 偽 CHATEVENT 戦略の検証 (= 不成立)

LIFF の Flex 送信ができるのを足がかりに、「本物の CHATEVENT (システム通知) を消せないなら、見た目を真似た Flex を周辺に撒いて埋没させる」という発想を実験。[src/write/send-liff-flex.ts](../src/write/send-liff-flex.ts) に `--preset chatevent` を追加して、小字グレー pill 風の Flex を送れるようにして実機 iPhone LINE で比較した。

### 結果: UI 描画が根本的に違う

| 項目 | 本物 CHATEVENT (`contentType=CHATEVENT`) | 偽物 Flex (`contentType=FLEX`) |
|---|---|---|
| 配置 | 画面中央 | 送信者側（左/右）に寄る |
| 背景 | 濃いグレー/黒 pill 型 | 明るいグレー角丸バブル |
| 送信者アバター | **非表示（特別扱い）** | 送信者の顔アイコンが出る |
| 送信者名 | **非表示** | 「竹内大登」等が出る |
| 時刻 | 本文に埋め込み | 横に別表示 |

**原因**: LINE クライアントは `contentType` を見て CHATEVENT だけ「システム通知」用の特別レンダリングを適用する。他のメッセージタイプ (Flex / Text / Image 等) ではこの特別描画は走らない。Flex のスタイル調整 (色・パディング・サイズ) をいくら追い込んでも、送信者アバター/名前の有無とバブル配置の違いは埋められない。

### 使えるとしたら

- 完全模倣は不可だが、**文字情報だけ混ぜる** 用途 (履歴検索でノイズになる、斜め読みでかろうじて紛れる) ならそれなり
- 戦略としては `--preset chatevent` を複数回送って本物の前後に撒く形で "ごちゃごちゃ感" を演出するくらい
- 本気で「相手の画面から CHATEVENT を消したい」なら、ここで示した通り構造的に不可能

### LIFF 抜け道の限界

CHATEVENT と MESSAGE_EDIT に関しては LIFF 経由でも回避できない。LIFF の `chat_message.write` scope は "通常の Bot が送信できるメッセージタイプを送信する" 権限であり、"システムメッセージの改変" や "message の rewrite" は含まれない (LINE 側がそもそもそういう権限概念を提供していない)。LIFF Flex が通ったのは Flex 自体が本来 Bot で送れるメッセージタイプだったから。LIFF は "Bot が送れる物の集合" を個人アカウントに移植できるだけで、Bot でも送れないものは出せない。

### editMessage の args 構造 (APK decompile で解明)

LINE Android APK (jp.naver.line.android) を jadx decompile して `sources/hi8/bj.java` (editMessage_args) と `sources/hi8/j9.java` (EditMessageRequest) を発見。args schema は以下:

```
editMessage_args:
  1: struct req → EditMessageRequest
EditMessageRequest:
  1: i32    reqSeq
  2: struct message → Message (from/to/toType/id/text/contentType/contentMetadata)
```

thrift 手製 payload で `/S4 editMessage` を叩くと、以前の汎用「invalid request」ではなく **`{"1":{"1":125,"2":"non-LYP subscriber requested edit"}}`** まで到達する (= 権限チェックまで通る)。

ただし main アカウントは `getDataRetention` で `productType=LYP_PREMIUM` 確認済みなのに editMessage 側では "non-LYP subscriber" 扱い。Multi Profile と同じく **スマホ公式アプリ側で機能ごとの規約同意が別途必要** と推定。

→ [src/write/edit-message.ts](../src/write/edit-message.ts) に実装済み (規約同意前は NOT_LYP で止まるが args 構造は確定)。

### silentlyUnsendMessage (Premium 通知なしで送信取消)

同じく APK decompile (`sources/hi8/oo.java` / `sources/hi8/ch.java`) で schema 発見:

```
silentlyUnsendMessage_args: { silentlyUnsendMessageRequest: { reqSeq: i32, messageId: string } }
```

叩くと `{"1":{"1":125,"2":"non-LYP subscriber requested silent unsend"}}` → args 正解、Premium 規約同意前はブロック。[src/write/silent-unsend.ts](../src/write/silent-unsend.ts) に実装。

### error code 125 = non-LYP subscriber (推定)

LINE サーバー側で LYP Premium 機能アクセスを拒否する際の共通エラーコードが **125** のようだ。
- `createMultiProfile` → `NOT_PREMIUM` (別フォーマット)
- `editMessage` → `code 125 "non-LYP subscriber requested edit"`
- `silentlyUnsendMessage` → `code 125 "non-LYP subscriber requested silent unsend"`

### Premium 系機能の規約同意フロー (推定)

- 加入自体 (LYP Premium 購読) ≠ 個別機能の利用権
- 各機能 (MESSAGE_EDIT / SUBPROFILE / PREMIUM_UNSEND 等) は **スマホ公式アプリ UI で機能に初回アクセスすると規約同意ダイアログが出てそこで accept が必要**
- 同意後はサーバー側のユーザーフラグが更新され、API 経由でも使えるようになる
- Mac LINE / Desktop LINE には多くの Premium 機能 UI が無いので、同意にはスマホ本体 LINE が必須

### LECC (Line Encrypted Client Context) 実装詳細

APK から LegyHmac クラス (`sources/jp/naver/line/android/legy/encryption/LegyHmac.java`) 発見:

```java
public class LegyHmac {
    public native byte[] hmac(byte[] bArr, byte[] bArr2);
    public native int lec_aes_decrypt(byte[] ctx, int version, long serial, byte[] in, byte[] out, byte[] mac);
    public native int lec_aes_encrypt(byte[] ctx, int version, long serial, byte[] in, byte[] out, byte[] mac);
    public native int lec_get_serialno(byte[] bArr);
    public native int lec_handshake_client_finish(byte[] bArr, byte[] bArr2, byte[] bArr3, byte[] bArr4);
    public native int lec_handshake_client_start(int version, byte[] bArr, byte[] bArr2);
    public native int lec_prepare_xfs(byte[] bArr, byte[] bArr2, byte[] bArr3);
}
```

6引数の `lec_aes_encrypt(ctx, version, serial, in, out, mac)` が LECC 暗号化のエントリ。
Frida hook は arg[3] (in 平文) + arg[2] (serial) で thrift payload を dump できる。

### CHATEVENT の UI 描画 (再確認)

`sources/na8/c.java` に enum (`na8.c.CHATEVENT = cVar14` 値 13) 定義。
`sources/xe8/c.java` の switch で `hi8.q7.CHATEVENT.ordinal() = 19` に分岐 →
contentType=CHATEVENT のメッセージは **専用の中央配置+アバター非表示の UI コンポーネントで描画** される。他の contentType ではこの switch case には入らない = Flex では完全模倣不可の決定的証拠。

### 未解明 (TODO)

- `scheduleMessage` の remote endpoint URL (kotlin coroutine 由来の難読化で地上 grep では見えず、REA/JEB 必要)
- `MESSAGE_BACKUP` の server API (local SQLite 優先実装のため remote 直叩き経路不明)
- `premiumBlocked` を立てる書き込み API (Contact 側は read-only field)

## 11. APK decompile 完了後の深堀り (171 thrift methods 中)

### 探索の統計
- `/S4` TalkService に **171 thrift methods** 存在。これまで触ったのは ~30 本
- 新たに通ったもの:

| method | 結果 |
|---|---|
| `getPendingAgreements` | `{"pendingAgreements":[]}` 空。Premium 機能別の同意はここでは追えない |
| `getConfigurations` | 巨大な configMap (サーバー side feature flags) 返却 |
| `getServerTime` | ms unix timestamp |
| `getExtendedProfile` | **自分の誕生日・公開レベル** (mid 引数指定しても常に自分のが返る) |
| `getRingtone` / `getRingbackTone` | 自分の着信音設定 (未設定なら空) |
| `getRecentFriendRequests` / `getFriendRequests` | 友だち申請 |
| `getBuddyLive` / `getBuddyOnAir` | /S4 では "Invalid method name"、別 endpoint 要 |
| `reportLocation` | 同じく別 endpoint |
| `getIncrementalBackupMessages` | `"API method not capable"` = Backup 機能契約が別途必要 |
| `getMessageEditNotice` | ERR 空 (要 args) |

### Premium 機能の規約・同意ルート (configMap から判明)

```
function.premium.common.subprofile.enabled = Y
function.premium.common.subprofile.agreement.lan = subprofilejp     # 同意名
function.premium.common.subprofile.agreement.version = 1
function.premium.common.unsend = Y
function.premium.common.unsend.agreement.lan = line_premium_unsend_JP
function.premium.common.unsend.agreement.version = 1
function.premium.common.unsend.system.link = https://line.me/R/nv/settings/lypPremium/home?entry=unsend_s
function.premium.lyp.service = Y
```

**→ 本当の規約同意フロー**: configMap に明記された `line://nv/settings/lypPremium/home?entry=unsend_s` などの LIFF/deep link をスマホ LINE で開くと、該当機能の規約画面に直接飛ぶ。承認後は該当機能の thrift が通る。

### LINE が持つ API ホスト (抜粋)

decompile から確認した全 API ホスト (`https://`):
- `api.line.me` - 主 REST API
- `access.line.me` - OAuth / consent
- `liff.line.me` - LIFF app host
- `obs.line-apps.com` - media 配信
- `ai-friends-api-server.line-apps.com` - **AI Friends API** (未探索)
- `contact-cc.line.me` - Contact 系
- `uts-front.line-apps.com` - UserTicket 系?
- `dpos-pay.line.me` / `app-payatom.line-apps.com` - LINE Pay
- `kyc-digital-id-client-gw.line-apps.com` - KYC Digital ID
- `vos.line-scdn.net` - VOOM/Timeline media
- `music.line.me` / `store.line.me` / `webpos.line.me`

AI Friends API (`/ai/agent`, `/ai/component`, `/ai/toolbox`) は未探索。LINE AI 系機能のバックエンド。

### 代替: route-send CLI (Multi Profile 不要の実質的ペルソナ分離)

[src/write/route-send.ts](../src/write/route-send.ts) で「相手ごとにどのサブアカから送るか」を [storage/routing.json](../storage/routing.json) に登録し、送信時に自動選択する運用。実質的に Multi Profile と同じ "相手ごとに別人として振る舞う" が、サブアカウント運用 (sub1/sub2) で実現できる。Premium 不要。
