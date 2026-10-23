#!/usr/bin/env bun
// openline — 個人LINE(linejs)操作をまとめた CLI。各サブコマンドは個別スクリプトに委譲する。
//
//   bun run openline.ts <コマンド> [引数...]
//   -a, --account <名前>   対象アカウント(sub1/sub2 …)。省略でメイン(storage.json)
//
// コマンド:
//   unread                 未読トーク一覧(既読はつけない)          [-a]
//   inbox                  新着メッセージのライブ監視(既読つけない) [-a]
//   unsend <相手> [opts]   自分の送信を取消(既定 dry-run, --yes で実行)[-a]
//   dump                   トーク履歴を JSONL/JSON に吸い出す        [-a]
//   accounts [サブコマンド] アカウント管理(list/new/open/login/emu)
//   login                  メイン(または -a)を QR ログイン
//   login-pw               メール+パスワードでログイン(-a と EMU=1 対応)
//
// 例: bun run openline.ts -a sub2 unread / bun run openline.ts unsend なお -m 売上 --yes
import { spawnSync } from "node:child_process";

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
	unread: "unread.ts",
	inbox: "inbox.ts",
	unsend: "unsend.ts",
	dump: "dump-logs.ts",
	accounts: "accounts.ts",
	login: "login-linejs.ts",
	"login-pw": "login-pw.ts",
};

if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help" || !SCRIPTS[cmd]) {
	const help = `openline — 個人LINE CLI
  bun run openline.ts <コマンド> [引数...]   (-a <名前> で sub1/sub2 …、省略でメイン)

  unread                 未読トーク一覧
  inbox                  新着のライブ監視
  unsend <相手> [--yes]  自分の送信を取消(既定 dry-run)
  dump                   トーク履歴を吸い出す
  accounts [list|new|open|login|emu ...]
  login | login-pw       ログイン`;
	console.log(help);
	process.exit(cmd && !SCRIPTS[cmd] && cmd !== "help" ? 1 : 0);
}

// accounts はアカウントを引数で取るので -a は素通し(env は無害)。他は ACCOUNT env で対象を切替。
const env = { ...process.env, ...(account ? { ACCOUNT: account } : {}) };
// "bun" だと proto シムの再帰でこける(process.execPath で今の bun を直接呼ぶ)
const r = spawnSync(process.execPath, ["run", SCRIPTS[cmd], ...args], { stdio: "inherit", env, cwd: import.meta.dir });
process.exit(r.status ?? 1);
