// LINE 通話の招待 URL (Call Link / Group Call URL) を作成する CLI。Zoom のミーティングURL的な使い方。
// 作ると `https://line.me/call/invite/...` 形式のURLが得られ、参加者はそれを開くと LINE 通話に入れる。
//
//   bun run src/write/call-link.ts "ミーティング名"              # dry-run
//   bun run src/write/call-link.ts "ミーティング名" --yes         # 作成して URL 表示
//   bun run src/write/call-link.ts --list                         # 自分が作った既存の call link 一覧
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const callMod: any = await import("../../node_modules/@evex/linejs/base/service/call/mod.js");

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		list: { type: "boolean", default: false },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const call = new callMod.CallService(client.base);

if (opt.list) {
	try {
		const r: any = await call.getGroupCallUrls({});
		const urls = r?.urls ?? r?.groupCallUrls ?? [];
		console.log(`[${me.displayName}] 作成済み call link: ${urls.length}`);
		for (const u of urls) {
			const id = u?.id ?? u?.urlId ?? "?";
			const title = u?.title ?? u?.name ?? "(no title)";
			console.log(`  ${id}  ${title}  https://line.me/call/invite/${id}`);
		}
	} catch (e: any) { console.error(`list 失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`); process.exit(1); }
	process.exit(0);
}

const TITLE = positionals[0];
if (!TITLE) die(`usage: bun run src/write/call-link.ts "ミーティング名" [--yes]  |  --list`);

console.log(`アカウント: ${me.displayName}`);
console.log(`タイトル:   ${TITLE}`);
if (!opt.yes) { console.log("[dry-run] 作成するには --yes を付けてください。"); process.exit(0); }

try {
	const r: any = await call.createGroupCallUrl({ request: { title: TITLE } });
	console.log("\n作成成功。response:");
	console.log(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 500));
	const id = r?.id ?? r?.urlId ?? r?.url;
	if (id) console.log(`\n招待URL: https://line.me/call/invite/${id}`);
} catch (e: any) {
	console.error(`作成失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
