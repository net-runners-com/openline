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
