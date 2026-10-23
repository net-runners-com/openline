# openline

個人LINE(linejs 経由)を CLI で操作するスクリプト群。

```bash
bun install
```

認証ファイル(`storage/*.json` / `.env` / `.qr-*.png` / `out/`)はコミット禁止(`.gitignore` 済み)。
以下の例の名前・mid はダミー。

## ディレクトリ

```
src/
├── openline.ts        # dispatcher
├── auth/              # ログイン・アカウント管理・エミュ操作
├── read/              # 読み取り・検索・履歴吸出し
└── write/             # 送信・取消・名前変更
storage/               # ログイン後のトークン(gitignored)
out/                   # 履歴吸い出しの出力先(gitignored)
```

## ディスパッチャ

```bash
bun run src/openline.ts <コマンド> [引数...]     # 各サブコマンドを個別スクリプトに委譲
bun run src/openline.ts -a sub1 <コマンド> ...    # 対象アカウント指定(sub1/sub2)。省略でメイン(storage/main.json)
```

### 共通環境変数

- `ACCOUNT=sub1` — 対象アカウント切替(`storage/sub1.json`)
- `DEVICE=IOSIPAD` — クライアント種別を上書き(既定は storage に保存された値 or DESKTOPWIN)
- `ENC=0` — 送信時 E2EE を無効化(既定は E2EE オン)

## セットアップ (`src/auth/`)

| スクリプト | 用途 |
|---|---|
| [login-linejs.ts](./src/auth/login-linejs.ts) | QR でログイン(PNG に書き出してスマホの LINE で読む。macOS は自動で Preview が開く) |
| [login-pw.ts](./src/auth/login-pw.ts) | メール+パスでログイン。`EMU=1` でエミュ内 LINE に確認コード自動入力 |
| [accounts.ts](./src/auth/accounts.ts) | 複数アカウントの一覧・新規作成・前面化(本体LINE はエミュ内に置く運用) |
| [emu.ts](./src/auth/emu.ts) | Android エミュ(adb)操作。他スクリプトから import |

```bash
# メインアカウントを QR でログイン → storage/main.json(QR PNG が開く)
bun run src/auth/login-linejs.ts
# NO_OPEN=1 bun run src/auth/login-linejs.ts     # PNG は書くが自動で開かない
# NO_IMAGE=1 bun run src/auth/login-linejs.ts    # PNG を作らず URL だけ出す

# サブアカウントをメール+パスでログイン(エミュで確認コードを自動入力)
ACCOUNT=sub1 EMU=1 bun run src/auth/login-pw.ts

# 保存済みアカウント一覧
bun run src/auth/accounts.ts
# (main)   山田 太郎        メール/PW:なし  本体:実機スマホ
# sub1     佐藤 花子        メール/PW:あり  本体:エミュレーター(停止中)
```

## 読む (`src/read/`、読み取り系・既読をつけない)

| スクリプト | 用途 |
|---|---|
| [unread.ts](./src/read/unread.ts) | 未読トーク一覧 + 各トーク直近 N 件(既定 3) |
| [inbox.ts](./src/read/inbox.ts) | 新着を定期ポーリングで監視(JSON出力モード有) |
| [list-chats.ts](./src/read/list-chats.ts) | 最近のトーク(messageBox)列挙 |
| [list-groups.ts](./src/read/list-groups.ts) | 参加中のグループ一覧 |
| [search-friends.ts](./src/read/search-friends.ts) | 友だちを表示名/メモ名で検索 |
| [search-messages.ts](./src/read/search-messages.ts) | 全/一定数の messageBox をキーワード走査 |
| [check-contact.ts](./src/read/check-contact.ts) | 指定 mid が友だちか/名前は何か |
| [fetch-one.ts](./src/read/fetch-one.ts) | 単一相手の履歴をサーバーから遡って JSONL 化 |
| [dump-logs.ts](./src/read/dump-logs.ts) | タグ付き or 全友だちのトーク履歴を一括バックアップ |

```bash
bun run src/read/unread.ts
# ● 田中 一郎  (未読 3)
#    相手 2026/10/23 20:02  おつかれさま！明日のMTGの件…
# ● マーケ合宿グループ  (未読 12)

bun run src/read/inbox.ts                                 # 人間向け1行表示を監視
POLL=15 bun run src/read/inbox.ts --json                  # 1件1行 JSON(Monitor/他プロセス連携用)

bun run src/read/search-friends.ts "やまだ"
# u1234...abcd  山田 太郎

bun run src/read/search-messages.ts "領収書" 50 20       # 直近20 box に対し各50件走査

bun run src/read/fetch-one.ts u1234...abcd 500           # 500件を上限にサーバーから遡取
# 500 msgs → ./out/one-u1234abc-1792761xxxxxx/messages.jsonl

TAG=jn bun run src/read/dump-logs.ts                     # 表示名メモに "jn" を含む友だちだけ
TAG= bun run src/read/dump-logs.ts                       # 全友だち
```

**サーバー履歴の保存期間**: LINE はクライアント(スマホ)側がプライマリで、サーバーの履歴は数ヶ月〜1〜2年の肌感。長期間非アクティブなトークは `getPreviousMessagesV2` で 0 件返る。復元が必要なら実機のバックアップが唯一の経路。

## 書く (`src/write/`、送信・取消・名前変更)

| スクリプト | 用途 |
|---|---|
| [send.ts](./src/write/send.ts) | DM/グループへメッセージ送信。既定 dry-run、`--yes` で実送信 |
| [unsend.ts](./src/write/unsend.ts) | 自分が送った直近メッセージを送信取消(24時間以内) |
| [rename-friend.ts](./src/write/rename-friend.ts) | 友だちの表示名オーバーライド(メモ名)を変更。相手には影響しない |

```bash
bun run src/write/send.ts "やまだ" -t "明日の13時空いてますか？"             # dry-run
bun run src/write/send.ts "やまだ" -t "明日の13時空いてますか？" --yes       # 送信
bun run src/write/send.ts "やまだ" -f draft.txt --yes                        # ファイル内容を送信
bun run src/write/send.ts c1234...xyz -t "グループ宛"                        # グループは mid で指定

bun run src/write/unsend.ts "やまだ"                                         # dry-run(取消候補を表示)
bun run src/write/unsend.ts "やまだ" -m 領収書 --yes                         # "領収書" を含む直近送信を取消

bun run src/write/rename-friend.ts "山田" -n "やまだ" --yes                  # メモ名を "やまだ" に
bun run src/write/rename-friend.ts "やまだ" --clear --yes                    # オーバーライド解除(本名表示に戻す)
```

## 新着の即時通知(Claude Code 連携)

`src/read/inbox.ts --json` を `run_in_background` で起動 → `Monitor` でそのstdoutを watch → セッション中は新着1件が1通知として流れる。
`client.listen()`(push 方式)は実機スマホ側と revision を奪い合うため、現状はポーリング方式を採用。

```bash
POLL=15 bun run src/read/inbox.ts --json  # 15秒ごとに getMessageBoxes(unreadOnly) を diff
```

## 認証・運用メモ

- 複数デバイス併用: 実機スマホ本体LINE と `DESKTOPWIN`/`IOSIPAD` セッションは共存可。ただし `client.listen()`(push) は revision 競合で届かないことがあるため、監視はポーリング方式(`src/read/inbox.ts`)を推奨
- サブアカウント本体: Pixel_8 エミュ内に置く。`-no-snapshot-save` は禁止(セッション破損)
- 送信系は原則 dry-run を既定、`--yes` 明示で初めて反映
- 認証ファイルは `.gitignore` 済み。コミット前に `git status` を確認
