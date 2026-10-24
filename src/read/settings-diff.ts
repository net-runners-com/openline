// 2 アカウント間で LINE 設定の差分を出す CLI。
//
//   bun run src/read/settings-diff.ts main sub2             # main と sub2 の設定比較
//   bun run src/read/settings-diff.ts main sub2 --all       # 同じ値も含めて全部出す
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { all: { type: "boolean", default: false } },
});
if (positionals.length !== 2) { console.error("usage: bun run src/read/settings-diff.ts <acc1> <acc2> [--all]"); process.exit(1); }
const [A, B] = positionals;

async function fetchSettings(account: string): Promise<Record<string, any>> {
	const path = `./storage/${account}.json`;
	if (!existsSync(path)) throw new Error(`storage なし: ${path}`);
	const storage = new FileStorage(path);
	const cached = await storage.get(".auth");
	if (typeof cached !== "string") throw new Error(`${account}: 未ログイン`);
	const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
	const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
	await storage.set(".auth", client.authToken);
	const r: any = await client.base.talk.getSettings({ syncReason: "INTERNAL" as any });
	// BigInt を文字列化してシリアライズ可能に
	return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v));
}

const [sa, sb] = await Promise.all([fetchSettings(A), fetchSettings(B)]);
const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);

const rows: { key: string; a: any; b: any; diff: boolean }[] = [];
for (const k of keys) {
	const va = sa[k];
	const vb = sb[k];
	const diff = JSON.stringify(va) !== JSON.stringify(vb);
	rows.push({ key: k, a: va, b: vb, diff });
}
rows.sort((a, b) => a.key.localeCompare(b.key));

const filtered = opt.all ? rows : rows.filter((r) => r.diff);
console.log(`${filtered.length} / ${rows.length} 項目 (${A} vs ${B})\n`);
for (const r of filtered) {
	const mark = r.diff ? "≠" : "=";
	const va = JSON.stringify(r.a) ?? "undefined";
	const vb = JSON.stringify(r.b) ?? "undefined";
	console.log(`${mark} key=${r.key.padEnd(5)} ${A}=${va.slice(0, 60).padEnd(60)} ${B}=${vb.slice(0, 60)}`);
}
process.exit(0);
