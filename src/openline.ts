#!/usr/bin/env bun
// openline — 個人LINE(linejs)操作をまとめた CLI。各サブコマンドは個別スクリプトに委譲する。
//
//   bun run src/openline.ts <コマンド> [引数...]
//   bun run src/openline.ts help                          # 全コマンド一覧
//   -a, --account <名前>   対象アカウント(sub1/sub2 …)。省略でメイン(storage/main.json)
//
// 例:
//   bun run src/openline.ts -a sub2 unread
//   bun run src/openline.ts send あらかわ -t "hello" --yes
//   bun run src/openline.ts friend-ticket --days 7 --uses 5 --yes
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");

const argv = Bun.argv.slice(2);
let account: string | undefined;
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "-a" || argv[i] === "--account") { account = argv[++i]; continue; }
	rest.push(argv[i]);
}
const [cmd, ...args] = rest;

const SCRIPTS: Record<string, { path: string; desc: string; group: string }> = {
	// auth
	"login": { path: "src/auth/login-linejs.ts", desc: "QR でログイン(PNG 自動 open)", group: "auth" },
	"login-pw": { path: "src/auth/login-pw.ts", desc: "メール+パスワードでログイン", group: "auth" },
	"accounts": { path: "src/auth/accounts.ts", desc: "複数アカウント管理 (list|new|open|login|emu)", group: "auth" },

	// read
	"unread": { path: "src/read/unread.ts", desc: "未読トーク一覧", group: "read" },
	"inbox": { path: "src/read/inbox.ts", desc: "新着を定期監視(ポーリング)", group: "read" },
	"inbox-multi": { path: "src/read/inbox-multi.ts", desc: "複数アカの新着を同時監視", group: "read" },
	"list-chats": { path: "src/read/list-chats.ts", desc: "最近のトーク(messageBox)", group: "read" },
	"list-groups": { path: "src/read/list-groups.ts", desc: "参加中グループ一覧", group: "read" },
	"search-friends": { path: "src/read/search-friends.ts", desc: "友だち名前で検索", group: "read" },
	"search-messages": { path: "src/read/search-messages.ts", desc: "メッセージ本文を走査検索", group: "read" },
	"check-contact": { path: "src/read/check-contact.ts", desc: "mid を友だち/連絡先データ確認", group: "read" },
	"fetch-one": { path: "src/read/fetch-one.ts", desc: "単一相手の履歴を JSONL 化", group: "read" },
	"dump": { path: "src/read/dump-logs.ts", desc: "タグ or 全友だちのトーク履歴吸い出し", group: "read" },
	"read-range": { path: "src/read/read-range.ts", desc: "グループで誰がどこまで読んだか", group: "read" },
	"contact-calendar": { path: "src/read/contact-calendar.ts", desc: "友だちの誕生日取得", group: "read" },
	"nearby": { path: "src/read/nearby.ts", desc: "GPS で近くの LINE ユーザー取得", group: "read" },
	"find-by-phone": { path: "src/read/find-by-phone.ts", desc: "電話番号から mid 特定", group: "read" },
	"my-qr": { path: "src/read/my-qr.ts", desc: "自分の友だち追加 URL/QR 表示", group: "read" },
	"settings-dump": { path: "src/read/settings-dump.ts", desc: "全 LINE 設定を JSON dump", group: "read" },
	"settings-diff": { path: "src/read/settings-diff.ts", desc: "2 アカの設定差分", group: "read" },
	"voom": { path: "src/read/voom-feed.ts", desc: "VOOM フィード取得", group: "read" },
	"autoresponder": { path: "src/read/autoresponder.ts", desc: "ルールマッチで自動返信 (常駐)", group: "read" },
	"group-bot": { path: "src/read/group-bot.ts", desc: "グループ運営自動化 (welcome/farewell/keyword)", group: "read" },

	// write
	"send": { path: "src/write/send.ts", desc: "メッセージ送信", group: "write" },
	"send-location": { path: "src/write/send-location.ts", desc: "位置情報メッセージ送信", group: "write" },
	"send-flex": { path: "src/write/send-flex.ts", desc: "Flex 送信(talk 直叩き、個人アカ不可)", group: "write" },
	"send-liff-flex": { path: "src/write/send-liff-flex.ts", desc: "LIFF 経由 Flex 送信 (個人アカOK, 複数preset)", group: "write" },
	"send-liff-all": { path: "src/write/send-liff-all.ts", desc: "LIFF 経由で全 10 タイプを batch 送信", group: "write" },
	"send-reply": { path: "src/write/send-reply.ts", desc: "Reply + Mention 対応送信", group: "write" },
	"route-send": { path: "src/write/route-send.ts", desc: "相手ごとに送信元アカを切り替え", group: "write" },
	"unsend": { path: "src/write/unsend.ts", desc: "自分の送信取消", group: "write" },
	"rename": { path: "src/write/rename-friend.ts", desc: "友だち表示名オーバーライド", group: "write" },
	"contact-settings": { path: "src/write/contact-settings.ts", desc: "ブロック/非表示/お気に入り/ミュート", group: "write" },
	"profile": { path: "src/write/profile-update.ts", desc: "自分の displayName/status 更新", group: "write" },
	"react": { path: "src/write/react.ts", desc: "メッセージに Reaction(ハート等)", group: "write" },
	"announcement": { path: "src/write/announcement.ts", desc: "グループアナウンス投稿/取得/削除", group: "write" },
	"friend-ticket": { path: "src/write/friend-ticket.ts", desc: "友だち追加URL(1回限り) 発行", group: "write" },
	"group-ticket": { path: "src/write/group-ticket.ts", desc: "グループ招待URL 再発行", group: "write" },
	"call-link": { path: "src/write/call-link.ts", desc: "LINE 通話 招待URL 作成/一覧", group: "write" },
	"multi-profile": { path: "src/write/multi-profile.ts", desc: "Multi Profile (LYP Premium 必須)", group: "write" },
};

if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help" || !SCRIPTS[cmd]) {
	const groups = ["auth", "read", "write"];
	console.log("openline — 個人LINE CLI\n");
	console.log("  bun run src/openline.ts <コマンド> [引数...]  (-a <名前> で sub1/sub2 …)\n");
	for (const g of groups) {
		const items = Object.entries(SCRIPTS).filter(([, v]) => v.group === g);
		console.log(`[${g}]`);
		for (const [k, v] of items) console.log(`  ${k.padEnd(18)} ${v.desc}`);
		console.log("");
	}
	console.log("詳しい使い方は各スクリプトの冒頭コメント or docs/notes.md を参照");
	process.exit(cmd && !SCRIPTS[cmd] && cmd !== "help" ? 1 : 0);
}

const env = { ...process.env, ...(account ? { ACCOUNT: account } : {}) };
const r = spawnSync(process.execPath, ["run", SCRIPTS[cmd].path, ...args], { stdio: "inherit", env, cwd: PROJECT_ROOT });
process.exit(r.status ?? 1);
