# openline

個人LINE(linejs 経由)を CLI で操作するスクリプト群 (36 本)。

```bash
bun install
bun run src/openline.ts help     # 全コマンド一覧
```

認証ファイル(`storage/*.json` / `.env` / `.qr-*.png` / `out/`)はコミット禁止(`.gitignore` 済み)。
以下の例の名前・mid はダミー。

## ディレクトリ

```
src/
├── openline.ts        # dispatcher (全 CLI を呼べる)
├── auth/              # ログイン・アカウント管理・エミュ操作
├── read/              # 読み取り・検索・履歴吸出し・自動化
└── write/             # 送信・取消・プロフィール・アナウンス etc
storage/               # ログイン後のトークン・設定ファイル (gitignored)
out/                   # 履歴吸い出しの出力先 (gitignored)
docs/notes.md          # API/プロトコル仕様の検証結果・制約・セキュリティメモ
```

## ディスパッチャ

```bash
bun run src/openline.ts <コマンド> [引数...]     # 下記のどの CLI も呼べる
bun run src/openline.ts -a sub1 <コマンド> ...    # 対象アカウント切替 (sub1/sub2 ... / 省略で main)
bun run src/openline.ts help                      # コマンド一覧
```

### 共通環境変数

- `ACCOUNT=sub1` — 対象アカウント切替(`storage/sub1.json`)
- `DEVICE=IOSIPAD` — クライアント種別上書き (既定は storage に保存された値 or DESKTOPWIN)
- `ENC=0` — 送信時 E2EE を無効化 (既定は E2EE オン)
- `POLL=15` — 常駐 CLI (inbox/autoresponder/group-bot) のポーリング間隔(秒)

## 認証 (`src/auth/`)

| コマンド | 用途 |
|---|---|
| [login](./src/auth/login-linejs.ts) | QR でログイン (PNG に書き出して Preview で開く) |
| [login-pw](./src/auth/login-pw.ts) | メール+パスでログイン (`EMU=1` でエミュから認証コード自動入力) |
| [accounts](./src/auth/accounts.ts) | 複数アカウント一覧・新規作成・前面化・ログイン・emu 操作 |

## 読む (`src/read/`、既読をつけない)

| コマンド | 用途 |
|---|---|
| [unread](./src/read/unread.ts) | 未読トーク一覧 + 各トーク直近 N 件 |
| [inbox](./src/read/inbox.ts) | 新着を定期ポーリング監視 (JSON mode あり、Monitor 連携用) |
| [inbox-multi](./src/read/inbox-multi.ts) | 複数アカの新着を同時監視して 1 ストリームにマージ |
| [list-chats](./src/read/list-chats.ts) | 最近のトーク(messageBox) 列挙 |
| [list-groups](./src/read/list-groups.ts) | 参加中グループ一覧 |
| [search-friends](./src/read/search-friends.ts) | 友だち名で検索 |
| [search-messages](./src/read/search-messages.ts) | メッセージ本文を走査検索 |
| [check-contact](./src/read/check-contact.ts) | mid の友だち/連絡先データ確認 |
| [fetch-one](./src/read/fetch-one.ts) | 単一相手の履歴を JSONL 化 |
| [dump](./src/read/dump-logs.ts) | タグ or 全友だちのトーク履歴吸い出し |
| [read-range](./src/read/read-range.ts) | グループで誰がどこまで読んだか（公式UIの既読N の裏データ） |
| [contact-calendar](./src/read/contact-calendar.ts) | 友だちの誕生日データ取得 |
| [nearby](./src/read/nearby.ts) | GPS で近くの LINE ユーザー検索 (要オプトイン) |
| [find-by-phone](./src/read/find-by-phone.ts) | 電話番号から mid 特定 (倫理的グレー、要注意) |
| [my-qr](./src/read/my-qr.ts) | 自分の友だち追加 URL/QR 表示 |
| [settings-dump](./src/read/settings-dump.ts) | 全 LINE 設定を JSON dump (隠し設定含む) |
| [settings-diff](./src/read/settings-diff.ts) | 2 アカの設定差分 |
| [voom](./src/read/voom-feed.ts) | VOOM (旧タイムライン) フィード取得 |
| [autoresponder](./src/read/autoresponder.ts) | ルールマッチで自動返信 (常駐) |
| [group-bot](./src/read/group-bot.ts) | グループ運営自動化 (welcome/farewell/keyword) |

**サーバー履歴の保存期間**: LINE はクライアント(スマホ)側がプライマリで、サーバーは数ヶ月〜1〜2年の肌感。長期間非アクティブなトークは `getPreviousMessagesV2` で 0 件返る。復元が必要なら実機のバックアップが唯一の経路。

## 書く (`src/write/`、送信・設定変更)

| コマンド | 用途 |
|---|---|
| [send](./src/write/send.ts) | DM/グループへメッセージ送信 (dry-run 既定、`--yes` で送信) |
| [send-location](./src/write/send-location.ts) | 位置情報メッセージ送信 (CoreLocationCLI 自動連携) |
| [send-flex](./src/write/send-flex.ts) | Flex を `talk.sendMessage` で送信 (個人アカは拒否される参考実装) |
| [send-liff-flex](./src/write/send-liff-flex.ts) | **LIFF 経由で Flex 送信 (個人アカOK)**。preset: hello/rich/schedule/chatevent |
| [send-liff-all](./src/write/send-liff-all.ts) | LIFF 経由で 10 タイプを batch 送信 (image/video/audio/sticker/template/flex 等) |
| [send-reply](./src/write/send-reply.ts) | Reply + Mention 対応送信 |
| [route-send](./src/write/route-send.ts) | 相手ごとに送信元アカを切替 (**Multi Profile 代替**) |
| [unsend](./src/write/unsend.ts) | 自分の送信取消 (24 時間以内) |
| [rename](./src/write/rename-friend.ts) | 友だち表示名オーバーライド (メモ名) |
| [contact-settings](./src/write/contact-settings.ts) | ブロック/非表示/お気に入り/ミュート |
| [profile](./src/write/profile-update.ts) | 自分の displayName/statusMessage 更新 |
| [react](./src/write/react.ts) | メッセージに Reaction (NICE/LOVE/FUN/AMAZING/SAD/OMG/UNDO/ALL) |
| [announcement](./src/write/announcement.ts) | グループトーク上部アナウンス投稿/取得/削除 |
| [friend-ticket](./src/write/friend-ticket.ts) | 1回限りの友だち追加URL発行 |
| [group-ticket](./src/write/group-ticket.ts) | グループ招待URL 再発行 |
| [call-link](./src/write/call-link.ts) | LINE 通話招待URL (Zoom 風) 作成/一覧 |
| [multi-profile](./src/write/multi-profile.ts) | Multi Profile (**LYP Premium 必須**) |

## よく使う例

```bash
# ログイン(初回)
bun run src/openline.ts login                                        # QR で main アカ
ACCOUNT=sub1 EMU=1 bun run src/openline.ts login-pw                  # メール+パスで sub1

# 未読チェック + 新着監視
bun run src/openline.ts unread
POLL=15 bun run src/openline.ts inbox --json                         # Monitor/他ツール連携用 JSON

# 送信
bun run src/openline.ts send "やまだ" -t "明日の13時空いてますか？" --yes
bun run src/openline.ts send-liff-flex "やまだ" --preset rich --yes  # Flex カード送信

# マーケ系
bun run src/openline.ts friend-ticket --days=30 --uses=5 --yes       # 名刺用の友だち追加URL
bun run src/openline.ts group-ticket "我がグループ" --yes             # グループ招待URL 再発行

# 自動化
echo '[{"match":"おはよう","reply":"おはようございます！","cooldownSec":300}]' > storage/autoreply-rules.json
bun run src/openline.ts autoresponder                                # 常駐、ルールマッチで自動返信
```

## 新着の即時通知 (Claude Code 連携)

`src/read/inbox.ts --json` を `run_in_background` で起動 → `Monitor` でそのstdoutを watch → セッション中は新着1件が1通知として流れる。
`client.listen()`(push 方式)は実機スマホ側と revision を奪い合うため、現状はポーリング方式を採用。

```bash
POLL=15 bun run src/openline.ts inbox --json  # 15秒ごとに getMessageBoxes(unreadOnly) を diff
```

## 認証・運用メモ

- 複数デバイス併用: 実機スマホ本体LINE と `DESKTOPWIN`/`IOSIPAD` セッションは共存可。ただし `client.listen()`(push) は revision 競合で届かないことがあるため、監視はポーリング方式(`inbox`)を推奨
- サブアカウント本体: Pixel_8 エミュ内に置く。`-no-snapshot-save` は禁止 (セッション破損)
- 送信系は原則 dry-run を既定、`--yes` 明示で初めて反映
- 認証ファイルは `.gitignore` 済み。コミット前に `git status` を確認

API/プロトコル仕様の検証結果・LIFF 経由の裏技メッセージ送信・LINE の乗っ取り経路と防御・CHATEVENT 削除の不可能性 等は [docs/notes.md](./docs/notes.md) にまとめている。
