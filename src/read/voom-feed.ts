// LINE VOOM (旧タイムライン) のフィードを取得する CLI。
// linejs の client.voom.* 経由。VOOM 専用の channel token を使う(通常 auth と別軸)。
//
//   bun run src/read/voom-feed.ts                   # 直近フィード
//   bun run src/read/voom-feed.ts --limit=20
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: { limit: { type: "string", default: "10" } },
});
const LIMIT = Number(opt.limit);

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();

console.log(`[${me.displayName}] VOOM フィード取得中…\n`);

try {
	const voom: any = (client as any).voom;
	// linejs の voom.feed() が存在するか/シグネチャが変わるので複数パターン試行
	let r: any;
	if (typeof voom?.feed === "function") {
		r = await voom.feed({ limit: LIMIT }).catch(() => voom.feed());
	} else if (typeof voom?.getHome === "function") {
		r = await voom.getHome({ limit: LIMIT });
	} else if (typeof (client as any).base?.timeline?.getHome === "function") {
		r = await (client as any).base.timeline.getHome({ limit: LIMIT });
	} else {
		console.error("VOOM API エントリポイントが見つからず(linejs のバージョン差分?)");
		console.error("exposed on client:", Object.keys(voom ?? {}).join(", "));
		process.exit(1);
	}
	console.log(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 3000));
} catch (e: any) {
	console.error(`失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 300)}`);
	process.exit(1);
}
process.exit(0);
