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
経路は存在しない。届けたいなら Messaging API push（`oa.ts`、メッセージ枠消費）のみ。

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

本人（竹内大登＝ひろと）の chatId: `U7b34195526d1a5aabe2d75e2e5ca1ec8`
