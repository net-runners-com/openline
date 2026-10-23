#!/usr/bin/env bun
// openline — 個人LINE(linejs)操作をまとめた CLI。各サブコマンドは個別スクリプトに委譲する。
//
//   bun run src/openline.ts <コマンド> [引数...]
//   -a, --account <名前>   対象アカウント(sub1/sub2 …)。省略でメイン(storage/main.json)
//
// コマンド:
//   unread                 未読トーク一覧(既読はつけない)          [-a]
//   inbox                  新着メッセージの監視(既読つけない)      [-a]
//   unsend <相手> [opts]   自分の送信を取消(既定 dry-run)         [-a]
//   send <相手> -t 本文    メッセージ送信(既定 dry-run)           [-a]
//   rename <相手> -n 名前  友だちの表示名オーバーライド           [-a]
//   dump                   トーク履歴を JSONL/JSON に吸い出す      [-a]
//   accounts [サブコマンド] アカウント管理(list/new/open/login/emu)
//   login                  QR でログイン(PNG)                      [-a]
//   login-pw               メール+パスワードでログイン             [-a]
//
// 例: bun run src/openline.ts -a sub2 unread
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");

const argv = Bun.argv.slice(2);
// -a/--account を先頭付近から抜き出す
let account: string | undefined;
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "-a" || argv[i] === "--account") { account = argv[++i]; continue; }
	rest.push(argv[i]);
}
const [cmd, ...args] = rest;

const SCRIPTS: Record<string, string> = {
	unread: "src/read/unread.ts",
	inbox: "src/read/inbox.ts",
	unsend: "src/write/unsend.ts",
	send: "src/write/send.ts",
	rename: "src/write/rename-friend.ts",
	dump: "src/read/dump-logs.ts",
	accounts: "src/auth/accounts.ts",
	login: "src/auth/login-linejs.ts",
	"login-pw": "src/auth/login-pw.ts",
};

if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help" || !SCRIPTS[cmd]) {
	const help = `openline — 個人LINE CLI
  bun run src/openline.ts <コマンド> [引数...]   (-a <名前> で sub1/sub2 …、省略でメイン)

  unread                 未読トーク一覧
  inbox                  新着のライブ監視
  send <相手> -t 本文    メッセージ送信(既定 dry-run)
  unsend <相手> [--yes]  自分の送信を取消(既定 dry-run)
  rename <相手> -n 名前  友だちの表示名オーバーライド
  dump                   トーク履歴を吸い出す
  accounts [list|new|open|login|emu ...]
  login | login-pw       ログイン`;
	console.log(help);
	process.exit(cmd && !SCRIPTS[cmd] && cmd !== "help" ? 1 : 0);
}

// 子スクリプトはプロジェクトルートを CWD として実行(./storage/..., ./out/... が解決できるように)
const env = { ...process.env, ...(account ? { ACCOUNT: account } : {}) };
const r = spawnSync(process.execPath, ["run", SCRIPTS[cmd], ...args], { stdio: "inherit", env, cwd: PROJECT_ROOT });
process.exit(r.status ?? 1);
