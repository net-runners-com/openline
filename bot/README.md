# bot

linejs (`@evex/linejs`) で LINE 個人アカウントを操作するスクリプト群と、公式アカウント(@492qwqka)送信用の補助。

```bash
bun install
bun run send.ts      # メッセージ送信（初回は LINE_EMAIL/LINE_PASSWORD or QR ログイン、以後 storage.json のトークン）
bun run list.ts      # 友だち一覧
NEW_NAME=xxx bun run rename.ts   # 表示名変更
```

- `chatbiz.md` / `chatbiz-send.js`: chat.line.biz 内部 API メモとブラウザコンソール用スクリプト
- `storage.json` / `.env` は認証情報。コミット禁止（.gitignore 済み）
