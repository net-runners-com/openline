# bot

LINE 公式アカウント(@492qwqka)を chat.line.biz 内部 API 経由で操作するスクリプト群。

```bash
bun install
bun run chatbiz.ts auth      # 初回だけログイン（cookie 保存、以後は API 直叩き）
bun run chatbiz.ts chats     # 会話成立している人の一覧（ページング対応）
bun run chatbiz.ts send <chatId> <text>
bun run chatbiz.ts card|sticker|file|schedule|broadcast ...
```

- `chatbiz.ts`: chat.line.biz 運用者送信の CLI（無料・replyToken 不要）
- `chatbiz.md` / `chatbiz-send.js`: chat.line.biz 内部 API メモとブラウザコンソール用スクリプト
- `manager-card.js`: カードタイプメッセージの作成
- `storage.json` / `.env` は認証情報。コミット禁止（.gitignore 済み）
