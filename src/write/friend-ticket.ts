// 友だち追加用の1回限りURL(UserTicket)を発行する CLI。期限+使用回数制限付き。
// URL を知った相手は LINE アプリで開くと自分が友だち追加される(自分の mid が露出しない)。
//
//   bun run src/write/friend-ticket.ts                               # 既定: 7日間、使用回数無制限で発行
//   bun run src/write/friend-ticket.ts --days=30 --uses=5           # 30日有効、5回まで
//   bun run src/write/friend-ticket.ts --days=1 --uses=1 --yes      # dry-run スキップ即発行
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: {
		days: { type: "string", default: "7" },
		uses: { type: "string", default: "0" },  // 0 = 無制限扱い(API 的な上限は別途)
		yes: { type: "boolean", short: "y", default: false },
	},
});
const DAYS = Number(opt.days);
const USES = Number(opt.uses);
function die(m: string): never { console.error(m); process.exit(1); }
if (!isFinite(DAYS) || DAYS <= 0 || DAYS > 365) die("--days は 1〜365");
if (!isFinite(USES) || USES < 0) die("--uses は 0 以上");

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

const expirationMs = BigInt(Date.now() + DAYS * 24 * 60 * 60 * 1000);
console.log(`アカウント: ${me.displayName}`);
console.log(`有効期限:  ${DAYS}日 (${new Date(Number(expirationMs)).toLocaleString("ja-JP")} まで)`);
console.log(`使用回数:  ${USES === 0 ? "無制限" : USES}`);
if (!opt.yes) { console.log("[dry-run] 発行するには --yes を付けてください。"); process.exit(0); }

try {
	const r: any = await talk.generateUserTicket({ expirationTime: expirationMs, maxUseCount: USES });
	const ticketId = r?.id ?? r?.ticketId ?? r;
	console.log(`\n発行成功。`);
	console.log(`ticketId: ${typeof ticketId === "object" ? JSON.stringify(ticketId) : ticketId}`);
	console.log(`友だち追加URL: https://line.me/ti/p/${ticketId}`);
} catch (e: any) {
	console.error(`発行失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
