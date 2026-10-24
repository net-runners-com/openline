// 残りの小粒 API を試す CLI。instant news / wake up long polling / repair elements /
// buddy (おすすめ公式アカ) をまとめて叩く。
//
//   bun run src/read/misc-probe.ts                   # 全部走らせる
//   bun run src/read/misc-probe.ts news|wake|repair|buddy
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const only = process.argv[2];

const buddyMod: any = await import("../../node_modules/@evex/linejs/base/service/buddy/mod.js");

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const talk = client.base.talk;
const buddy = new buddyMod.BuddyService(client.base);

function brief(label: string, obj: any) {
	console.log(`\n=== ${label} ===`);
	console.log(JSON.stringify(obj, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 1500));
}

if (!only || only === "news") {
	try {
		const r = await talk.getInstantNews({ region: "jp" });
		brief("InstantNews", r);
	} catch (e: any) { brief("InstantNews ERR", e?.data ?? e?.message); }
}

if (!only || only === "wake") {
	try {
		const r = await talk.wakeUpLongPolling({ clientRevision: 0n as any });
		brief("wakeUpLongPolling", r);
	} catch (e: any) { brief("wakeUpLongPolling ERR", e?.data ?? e?.message); }
}

if (!only || only === "repair") {
	try {
		const r = await talk.getRepairElements({});
		brief("Repair elements", r);
	} catch (e: any) { brief("Repair ERR", e?.data ?? e?.message); }
}

if (!only || only === "buddy") {
	try {
		const r = await buddy.getPromotedBuddyContacts({});
		brief("Promoted Buddy (おすすめ公式アカウント)", r);
	} catch (e: any) { brief("Buddy ERR", e?.data ?? e?.message); }
	try {
		const r2 = await buddy.getNewlyReleasedBuddyIds({});
		brief("Newly released Buddy", r2);
	} catch (e: any) { brief("NewlyReleased ERR", e?.data ?? e?.message); }
}

process.exit(0);
