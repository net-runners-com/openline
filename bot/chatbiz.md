# chat.line.biz 内部 API（@492qwqka から Messaging API を使わず送る経路）

OA Manager アプリ（`com.linecorp.lineoa`）は WebView で `chat.line.biz` を開いているだけ。
その Web コンソールの内部 API を直接叩く。**Messaging API ではない**（チャンネルトークン不要、
プッシュ課金枠を消費しない）。実測で確定済み。

## 前提

- **応答モードで「チャット」を ON** にしてあること（manager.line.biz → 設定 → 応答設定 → チャット）。
  Webhook と共存可（line-lake の自動配信は生きたまま）。OFF に戻すと全エンドポイントが
  `403 {"code":"not_chat_mode_bot"}` を返す。
- 認証は **chat.line.biz のセッション Cookie（httpOnly）**。`document.cookie` からは読めないため、
  **ブラウザのログイン済みコンテキストで実行**する（DevTools コンソール or 拡張の javascript_tool）。
  スタンドアロンの Bun スクリプト化は httpOnly Cookie 抽出が要るため不可。

## 構造的な制約（重要・実測で確定）

この経路は **OA に来た人への 1対1 返信のみ**。会話リストに載っているユーザー（＝過去に OA へ
メッセージを送ってきた人）にしか送れない。**任意の友だちへの初回プッシュはできない**
（それは Messaging API の push/broadcast の領域）。

沈黙フォロワー（追加はしたが一度も送ってきていない人）を chat 経路に載せる方法を全部試した結果:

| 試行 | 結果 | 意味 |
|---|---|---|
| `POST /chats/{silentUserId}/messages/send` | `400 not_found_chat` | 会話が無いと送れない |
| `POST /api/v1/bots/{bot}/chats {contactId}` (createChat) | `400` | 既存コンタクトが要る。沈黙者は不可 |
| `POST /api/v2/bots/{bot}/contacts` (create contact) | `405` | **コンタクト生成 API が存在しない** |

→ operator 側から沈黙フォロワーの「コンタクト」も「会話」も作れない。これは LINE のアンチスパム
設計。chat console（無料枠）で送れるのは、相手が先に話しかけてきた人だけ。

**OA userId はチャンネル専用の ID。** 個人アカウント(linejs)の友だち mid とは別名前空間で、
linejs では使えない（照合で0件確認済み）。沈黙フォロワーに OA 名義で届ける非 Messaging API
経路は存在しない。届けたいなら Messaging API push（メッセージ枠消費）のみ。

## エンドポイント（bot = `Ub4aa0ca3051d9abc64e21e982ec40537`）

| 用途 | メソッド・パス |
|---|---|
| 自分の情報 | `GET /api/v1/me` |
| 管理 OA 一覧 | `GET /api/v1/bots?limit=1000&noFilter=true` |
| チャットモード確認 | `GET /api/v4/bots/{bot}/settings/chatMode` |
| 会話一覧 | `GET /api/v2/bots/{bot}/chats?folderType=ALL&tagIds=&autoTagIds=&limit=25&prioritizePinnedChat=true` |
| メッセージ履歴 | `GET /api/v3/bots/{bot}/chats/{chatId}/messages` |
| **テキスト送信** | `POST /api/v1/bots/{bot}/chats/{chatId}/messages/send` |
| CSRF トークン | `GET /api/v1/csrfToken` → `{token}` |

`chatId` は相手の LINE userId（`U...` 32hex）。会話一覧の `chatId` フィールド。

## 送信リクエスト（実測で確定）

```
POST https://chat.line.biz/api/v1/bots/{bot}/chats/{chatId}/messages/send
Headers:
  Content-Type: application/json
  X-XSRF-TOKEN: <GET /api/v1/csrfToken の token>
Cookie: <セッション Cookie（fetch の credentials:'include' で自動付与）>
Body:
  {"type":"text","text":"本文","sendId":"<uuid>"}   ← sendId 必須（冪等キー）
```

`{"text":...}` や `{"messages":[...]}` は **400**。`sendId` 無しも通らない。
`{"type":"text","text":...,"sendId":<uuid>}` で **200**。

## 使い方

`chatbiz-send.js` の中身を chat.line.biz を開いた状態の DevTools コンソールに貼る。

```js
await chatbizChats();                 // 会話一覧（chatId + 最終メッセージ）
await chatbizSend('U7b3419...', '本文'); // 送信
```

テスト送信先の chatId 例: `U00000000000000000000000000000000`（会話一覧 `chatbizChats()` の chatId を使う）

## カードタイプメッセージ（2026-09-01 実測で確定）

chat 経路で送れる非テキストは **定型文 / カードタイプメッセージ / クーポン** の 3 種（作成欄「＋」）。
カードは manager.line.biz で事前作成したものを **ID 指定**で送る。実体は Flex。

| 用途 | メソッド・パス |
|---|---|
| カード一覧（`messageObject` に Flex 全文入り） | `GET /api/v1/bots/{bot}/cardTypeMessages?limit=25` |
| カード送信 | `POST /api/v1/bots/{bot}/chats/{chatId}/messages/send` |
| 送信済みメッセージの Flex 取得 | `GET .../chats/{chatId}/messages/flexJson?timestamp=&messageId=` |

送信 body（UI が実際に送ったもの）:

```json
{"id":"","type":"cardType","cardTypeMessageId":22055840,"sendId":"<chatId>_<ms>_<rand>"}
```

`sendId` は UUID でも通る。

**任意の Flex JSON は送れない。** `{"type":"flex",...}` を同エンドポイントに投げると
`400 {"code":"not_supported_message_type"}`（実測）。harness 側で Flex を生成して chatbiz に
流す経路は無く、manager で作ったカードの ID を harness に持たせる設計になる。

テスト用カード: ID `22055840`「テストカード」（パーソン型）。manager → メッセージアイテム → カードタイプメッセージ。

## カードを API で作る（manager.line.biz 側・2026-09-01 実測で確定）

manager.line.biz の内部 API でカードタイプメッセージを**プログラムから作成**できる。
作成 → chatbiz で ID 送信、を繋げれば「内容を動的に生成したカード/カルーセル」を無料枠で送れる
（実測: fetch で 2 枚カードを作成 → chatbiz 送信 → カルーセル表示を確認）。

| 用途 | メソッド・パス（origin は `https://manager.line.biz`） |
|---|---|
| カード作成 | `POST /api/bots/@492qwqka/cardTypeMessages` → `{"id": 22055960}` |

必須ヘッダ: `Content-Type: application/json`, `X-XSRF-TOKEN: <Cookie XSRF-TOKEN の値（JS から読める）>`,
`X-BotCms-ScriptRevision: 90.0.0`（UI が付けていた値。無しで通るかは未検証）。
認証は manager.line.biz のセッション Cookie。**chat.line.biz とは別オリジン**なので、
ブラウザ側スクリプトは manager タブ（作成）と chat タブ（送信）の 2 箇所で動かすか、
Tampermonkey の `GM_xmlhttpRequest` で跨ぐ。

body（UI が送ったものを整理。`origin` がフォーム状態で、サーバ側が Flex に変換する）:

```json
{
  "title": "アイテム名", "type": "Person", "actions": [],
  "origin": {
    "title": "アイテム名", "type": "Person",
    "messages": [
      {
        "image": {"isNoImage": true, "maxFile": 1, "list": [{"src": ""}]},
        "name": "カード名(20字)",
        "icons": [
          {"enable": true, "name": "タグ(12字)", "color": "info"},
          {"enable": false, "name": "", "color": "info"},
          {"enable": false, "name": "", "color": "info"}
        ],
        "description": {"enable": true, "value": "説明文(60字)"},
        "links": [
          {"enable": true, "title": "ボタン(15字)", "type": "Link", "url": "https://...", "shopCard": "", "urlInput": "https://..."},
          {"enable": false, "title": "", "type": "Choice", "url": ""}
        ]
      }
    ],
    "viewmore": {"enable": false, "type": "ADDITIONAL_SIMPLE", "images": [{"src": ""}], "link": {"enable": false, "title": "", "type": "Choice", "url": ""}}
  }
}
```

- `messages` を複数入れるとカルーセル（UI 上限 9 枚）
- `type`: `Person` のほか `Product` / `Location` / `Image`（フィールド構成は未取得）
- アクション `type`: `Link` / クーポン / ショップカード / リサーチ / テキスト（UI の選択肢。Link 以外の payload は未取得）
- 画像付きは別途アップロード API が要る（未取得）。`isNoImage: true` でデフォルト画像
- 任意 Flex を `origin` に混ぜる口は無い。自由度は「manager のカード UI で作れる範囲」まで

テストで作ったカード: `22055840`, `22055951`, `22055960`（manager → メッセージアイテム → カードタイプメッセージ から削除可）

### webtrace で追加判明（2026-09-01、HAR + manager JS バンドル解析）

**エンドポイント（manager.line.biz、認証・ヘッダは上と同じ）**

| 用途 | メソッド・パス |
|---|---|
| 画像アップロード | `POST /api/bots/@492qwqka/cardTypeMessages/image`（multipart、フィールド名 `file`）→ `{"imageUrl":"https://card-type-message.line-scdn.net/..."}` |
| 作成 | `POST /api/bots/@492qwqka/cardTypeMessages` → `{"id"}` |
| 更新 | `POST /api/bots/@492qwqka/cardTypeMessages/{id}`（同 body） |
| 詳細 / 一覧 / 件数 | `GET .../cardTypeMessages/{id}` / `GET .../cardTypeMessages` / `GET .../cardTypeMessages/count` |
| 削除 | `DELETE .../cardTypeMessages/{id}` |

画像は先にアップロードして返ってきた `imageUrl` を `image.list[0].src` に入れ、`isNoImage:false` にする（実測 200・送信表示 OK）。
外部 URL を `src` に直接入れられるかは未検証。

**origin.messages[] の型別スキーマ（バンドルの `defaultContent` そのまま）**

```
Product: {title, icon, image, description, price:{enable, value, unit}, links:[link, link]}
Place:   {title, icon, image, info:{enable, type:"oa.cardmessage.dropdown.infohours"|"...infoprice", value}, place:{enable, value, lat, lng}, links}
Person:  {image, name, icons:[icon, icon, icon], description, links}
Image:   {icon, image, link}          ← 画像1枚+ボタン1つ。リッチメッセージに一番近い
viewmore:{enable, type:"ADDITIONAL_SIMPLE"|"ADDITIONAL_IMAGE", images:[{src}], link}
icon={enable, name, color:"info"}  image={isNoImage, maxFile:1, list:[{src}]}  description={enable, value}
link={enable, title, type, ...}
```

- `price.unit` の選択肢: `none, ¥, NT $, ฿, Rp, $, £, ₩, €`
- link `type`: `Choice`(未選択) / `Link`→`url` / `Text`→`message`（タップで相手がそのテキストを送信）/ `Coupon` / `Shopcard` / `Research` / `Reservation`。Coupon 以降の payload キーは未取得（UI で選んで再トレースすれば取れる）
- 実測 body 例（Place 型・画像あり・Text アクション）: `{"title":"test","type":"Place","actions":[],"origin":{"title":"test","type":"Place","messages":[{"title":"saxa","icon":{"enable":true,"name":"asxa","color":"info"},"image":{"isNoImage":false,"maxFile":1,"list":[{"src":"<imageUrl>"}]},"info":{"enable":true,"type":"oa.cardmessage.dropdown.infohours","value":"asx"},"place":{"enable":true,"value":"axasx","lat":0,"lng":0},"links":[{"enable":true,"title":"aasx","type":"Text","shopCard":"","message":"sxax"},{"enable":false,"title":"","type":"Choice","url":""}]}],"viewmore":{...}}}` → `{"id":22056517}`

トレース: scratchpad `trace-linebiz-card/`（`trace.har` 34MB、Cookie 入り。repo に置かない）

## 送信レート上限（2026-09-01 実測・ヒロト宛 chatId 1 件で計測）

`POST .../messages/send` は **1 チャットあたり 20 通 / 60 秒**。21 通目から `429 {}`
（`Retry-After` 等のヘッダ無し）。

| 計測 | 結果 |
|---|---|
| 1通/秒 ×10 → 4通/秒 ×10 | 20 通 200、21 通目 429（約 15 秒） |
| 1通/2秒 で連投 | 20 通 200、21 通目 429（約 40 秒）→ 連続リフィル型ではなく窓カウント |
| 20 通バースト（3 秒）→ 5 秒間隔で再送 | バースト開始から **約 60 秒**で 200 復帰（2 回とも 62〜63 秒。時計の分境界とは無関係） |
| 429 中に送り続ける | 窓は延びない（5 秒間隔の 429 プローブ 9 回でも 60 秒で復帰） |

- 429 は捨てられるだけで、その後の 200 は通常どおり届く（バン・警告なし。合計約 85 通＋429 約 25 回）
- スコープが「チャット単位」か「bot 単位」か「operator 単位」かは**未検証**（別ユーザーへ試すとその人に届くため）
- ステップ配信で安全に回すなら **1 チャット 3 秒間隔（= 20 通/分）以下**、または 20 通ごとに 60 秒待つ
- `chatbizSendMany()`（`chatbiz-send.js`）がこのペーシングを内蔵

## chat 経路で送れる全タイプ（2026-09-01 実測・ヒロト宛で各1通確認）

`POST /api/v1/bots/{bot}/chats/{chatId}/messages/send`（JSON、`sendId` 必須）に `type` を変えて投げる。

| type | body | 結果 |
|---|---|---|
| `text` | `{"type":"text","text":"..."}` | ○ |
| `textV2` | `{"type":"textV2","text":"...","substitution":{...}}` | ○（絵文字/メンション置換用。UI は絵文字入りテキストをこれに変換して送る。`substitution` 無しなら普通の text として届く） |
| `sticker` | `{"type":"sticker","packageId":"11537","stickerId":"52002734"}` | ○（公式無料セット。`stickers/owned` に無いものが通るかは未検証） |
| `cardType` | `{"type":"cardType","cardTypeMessageId":22055840}` | ○（既出） |
| `coupon` | `{"type":"coupon","couponId":"<id>"}` | type は受理（存在しない ID → `400 coupon_not_found`）。クーポン本体は manager.line.biz で作る。作成 API は未取得（coupon ページの JS chunk が HAR に無い）。一覧は `GET /api/v1/bots/{bot}/coupons?page=1&pageSize=25` |
| `location` | `{"type":"location",...}` | × `not_supported_message_type` |
| `flex` | 任意 Flex | × `not_supported_message_type`（既出） |

**画像/ファイル送信**（multipart）: `POST .../messages/sendFile`、フィールド `file`（Blob）と `sendId`。
→ 200、履歴に `type:"image"` で載る（PNG で確認。動画/PDF は未検証）。
2段階版もある: `POST .../messages/uploadFile`（`file`）→ `POST .../messages/bulkSendFiles`（`{messages:[{sendId, contentMessageToken}]}` と推定、未検証）。

**予約送信**（`availableFeatures.scheduledMessage = SCHEDULED_MESSAGE_V1`）:

```
POST /api/v1/bots/{bot}/chats/{chatId}/messages/scheduled
{"message":{"id":"","type":"textV2","text":"本文"},"scheduledAt":<epoch ms>}
→ 200 {"scheduledMessageId":"agqf...","status":"SCHEDULED",...}
```

- `type:"text"` だと `400 {}`。**`textV2` のみ通る**（UI も textV2 に変換してから投げている）
- 一覧 `GET .../chats/{chatId}/messages/scheduled`、bot 全体 `GET /api/v1/bots/{bot}/messages/scheduled`
- 更新/削除 `PUT|DELETE .../messages/scheduled/{scheduledMessageId}`（未検証）
- UI 上は 5 分刻み。それ以外の時刻が通るかは未検証
- 実測: 14:00:00 指定 → 14:00:07 に `type:"text"` として着弾（登録後は一覧から消える）
- **これがサーバ側ステップ配信になる**: 送る側がプロセスを常駐させなくても、登録しておけば LINE 側が時間に送る

**定型文（savedReplies）**:

```
POST /api/v2/bots/{bot}/savedReplies
{"title":"名前","message":{"type":"text","text":"本文"},"isFavorite":false}   → 200 {}
GET  /api/v2/bots/{bot}/savedReplies?query=&excludeUsernamePlaceholder=false&sortKey=CREATED_AT&pageSize=25&page=1
```

`messages:[...]` (複数形) は 400。定型文は送信タイプではなく「本文をコピーして text で送る」もの。
`POST .../savedReplies/{id}/use` は使用回数カウントのみ。

**その他のエンドポイント**（chat バンドルから抽出、未検証）: `messages/{id}/unsend`（送信取消）、
`chats/{chatId}/typing`、`chats/{chatId}/notes`、`chats/{chatId}/tags`、`chats/{chatId}/nickname`、
`chats/{chatId}/done|followUp|assign|spam`、`messages/pin`、`messages/search`、`stickers/owned`、`emojis/owned`、
`tags/broadcastWithAudience`（タグ→オーディエンス作成。送信ではない）。

送信レート上限（20通/60秒）が sendFile / scheduled にも掛かるかは未検証。

## 無料枠を消費しないことの確認（2026-09-01 14:05）

今日 chat 経路で約 100 通（text 約 95・sticker・image・textV2・予約送信）送った後、
manager.line.biz ダッシュボードの「配信できるメッセージ通数」は **200 / 200**（月初リセット直後で消費ゼロ）。
chat 経路は Messaging API の月 200 通枠を消費しない（実測）。ダッシュボード表示の反映遅延の可能性は残る。

## 実運用カード: 30分無料相談（2026-09-01 作成・ヒロト宛送信確認）

- カード ID **`22058153`**（Person 型、manager → メッセージアイテム → カードタイプメッセージ「30分無料相談カード」）
- 画像: OA アイコン（`GET /api/v1/bots/{bot}` の `iconUrl`）を `cardTypeMessages/image` にアップロード → `https://card-type-message.line-scdn.net/card-type-message-image-2026/492qwqka/1788240335085-...`
- 内容: 名前「30分の無料相談、受付中」/ タグ Claude Code・AI 自動化・開発相談 / 説明 55 字 / ボタン「30分無料相談を予約」→ `https://hiroto-ai-botch.net/line-booking`
- 送信: `chatbizSendCard(chatId, 22058153)`。Person 型は写真が円形トリミング＋ボタンがテキストリンク表示（参考の Flex のような角丈画像・青ボタンにはならない）
- 画像の取得は manager タブ内の `fetch('https://profile.line-scdn.net/...')` が CORS で通った（Blob → FormData）

リッチメッセージ（manager → メッセージアイテム → リッチメッセージ）は chat 経路では送れない（2026-09-01 実測:
`type: imagemap / richMessage / rich` いずれも `400 not_supported_message_type`。chat バンドルの type enum にも無い）。
リッチメッセージは Messaging API 配信（メッセージ枠消費）専用。chat 経路の代替は **Image 型カードタイプメッセージ**（画像1枚＋ボタン1つ、タップ領域は1つ）。

## 参考: GitHub 上の chat.line.biz ラッパー（2026-09-01 調査）

| repo | 内容 |
|---|---|
| `Madoa5561/LINELib`（★13、2026-08 更新） | Python。`send_flex_message` は本 doc と同じ `cardType` + `cardTypeMessageId` 送信。リッチメッセージ送信は無し |
| `miloira/line-web`（★1、2024） | Python。chat + manager の内部 API（cmsUsers / groups / restrictChatMenu / responseSettings/enabledChat 等）。リッチメッセージ無し |

どちらも「chat 経路で送れる非テキスト = カードタイプ（Flex）だけ」で本 doc と一致。

LINELib から取れた未検証だった body:
- `bulkSendFiles`: `POST /api/v1/bots/{bot}/chats/{chatId}/messages/bulkSendFiles` `{"items":[{"sendId":"...","contentMessageToken":"<uploadFile の戻り>"}]}`
- `uploadFile` の戻り: `{"contentMessageToken": "..."}`
- 受信: `POST /api/v1/bots/{bot}/streamingApiToken` → SSE でチャットイベントを購読（`stream_events`）。Webhook 無しで着信を取れる経路

### 任意 Flex の注入は不可（2026-09-01 実測）

カード作成 `POST /api/bots/@492qwqka/cardTypeMessages` の body に `messageObject: {type:"flex", contents:{...}}` を
同梱しても **無視される**（作成は 200 だが GET 詳細/一覧に残らず、Flex は `origin` からサーバ側で再生成）。
chat 側の `cardTypeMessages` が返す `messageObject` もその生成結果。→ chat 経路の見た目は「manager のカード UI で作れる範囲」が上限で確定。
テストカード 22059514 は削除済み。
- chat 側 `send` に Flex を同梱する変種も全滅（2026-09-01）: `{type:"cardType", messageObject:{...}}` / `{type:"cardType", contents:{...}}` / `cardTypeMessageId:0 + messageObject` → `400 {}`、`{type:"flex", flexJson:"..."}` → `not_supported_message_type`。cardType は **保存済み ID の参照専用**。
- 予約送信は **textV2 のみ**（2026-09-01 実測: `cardType` / `sticker` を `message` に入れると `400 {}`）。カード・画像をステップに入れるなら送信側で時刻管理して `send` を叩く

## ブラウザ無しで叩く: `bot/chatbiz.ts`（2026-09-01）

httpOnly Cookie は webtrace の Playwright storage-state で書き出す。**ログインは人がやる、スクリプトは Cookie を使うだけ。**

```bash
bun run chatbiz.ts auth            # webtrace プロファイル(~/.claude/skills/webtrace/profiles/linebiz) から Cookie を .chatbiz-auth.json に書き出し
bun run chatbiz.ts auth --login    # セッション切れ時: headed ブラウザでログイン → Ctrl-C で保存
bun run chatbiz.ts me | chats
bun run chatbiz.ts send <chatId> <text>
bun run chatbiz.ts card <chatId> <cardId>
bun run chatbiz.ts sticker <chatId> <packageId> <stickerId>
bun run chatbiz.ts file <chatId> <path>
bun run chatbiz.ts schedule <chatId> <ISO時刻> <text>
bun run chatbiz.ts broadcast (--text <t> | --card <id>) [--only <chatId,..>] [--yes]   # --yes 無しはドライラン
```

- 使う Cookie は `chat.line.biz` / `.line.biz` ドメインのみ（`__Host-chat-ses`、`ses`、`XSRF-TOKEN`）。`CHATBIZ_COOKIE` 環境変数で上書き可
- CSRF は起動時に `GET /api/v1/csrfToken` で取得。UA / Origin / Referer はブラウザ相当を付ける（無しで通るかは未検証）
- 会話一覧は `limit` 上限 25（`exceeded_limit`）。ページング用パラメータは未取得（現状 10 件なので未対応）
- 「一斉配信」= 会話一覧の全員に 1 通ずつ順送り（3.1 秒間隔、429 は 60 秒待って再送）。チャットをまたいだレート上限は未計測
- 実測: `me` 200 / `send` 200 / `broadcast --card --only ヒロト --yes` 200。Chrome 拡張なしで動作
- `.chatbiz-auth.json` は `bot/.gitignore` 済み。セッション寿命は未計測（切れると 3xx リダイレクト → `auth --login`）
- プロファイルが前回の cloakbrowser に掴まれている時は `linebiz-copy` にコピーして書き出す（`auth` は現状これをやらない。手動: `cp -R linebiz linebiz-copy && rm linebiz-copy/Singleton*`）

## OA 管理アプリ（Android `com.linecorp.lineoa`）の通信先（2026-09-01 実測・mitmproxy 素通しモード）

Pixel 8 の global http_proxy 経由で観測。**復号は不可**（アプリが mitm CA を信用せず、復号モードだと白画面になる）。
接続先: `chat.line.biz` / `manager.line.biz` / `chat-streaming-api.line.biz`（SSE 着信） / `vos.line-scdn.net` / `static.line-scdn.net` / `uts-front.line-apps.com`（計測） / `emojipack.landpress.line.me`。
→ アプリは PC 版 Web と同じバックエンド。アプリ専用 API は無い。API の中身を見るなら PC の Web で取れば同じ。

## manager テスト配信 API（2026-09-01 実測・OA アプリも同じ API）

```
POST https://manager.line.biz/api/bots/@492qwqka/message/test
headers: Cookie(manager) / X-XSRF-TOKEN / X-BotCms-ScriptRevision: 90.0.0 / Content-Type: application/json
{"target":"SELF","balloons":[...],"membershipTargeting":null}      # target: "SELF" | "ALL"(全管理者)
```

balloon（composer chunk `3d8933…js` の sendTest 変換より）:
- `{"contentType":"TEXT","text":"…","emojis":[]}` → 200 OK
- `{"contentType":"FLEX","key":<cardTypeMessageId>}` → **200 OK**（カードの Flex が自分に届く）
- `{"contentType":"FLEX","messageObject":{Flex}}`（inline、key 無し/空） → 400
- 他: `RICH`(リッチメッセージ, key) / `RICH_VIDEO` / `COUPON` / `RESEARCH` / `IMAGE`,`VIDEO`,`VOICE`(key=contents id) / `STICKER`(stickerId) / `RESERVATION`

→ テスト配信は無料だが **宛先は管理者自身のみ**。Flex は chat 経路と同じく「保存済み key の参照」だけで、任意 JSON は通らない。
本番配信 `POST /api/bots/@492qwqka/broadcasts/v2` も同じ balloon 形式（未実行・枠消費）。

## test エンドポイントで友だちに向けられるか → 不可（2026-09-01 総当たり）

`POST /api/bots/@492qwqka/message/test` の `target` は **enum {SELF, ALL} で閉じている**。

| body | 結果 |
|---|---|
| `target:"AUDIENCE"+audienceId` / `"CHAT_TAG"+chatTagId` / `"TAG"` / userId直接 | 400（enum 外） |
| `target:"ALL"` + `membershipTargeting:{audienceGroupId}` / `audienceIds:[]` / `recipients:[userId]` | 200（余計なフィールドは**無視**され、ALL=全運用担当者に送られるだけ） |

→ userId / タグ / ラベル / オーディエンスを test に差しても宛先は変わらない。テスト配信は運用担当者限定で確定。
オーディエンス（チャットタグ型）は「有効」になるが、それを使えるのは本番 `broadcasts/v2`（枠消費）だけ。
