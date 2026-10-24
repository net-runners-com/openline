// LINE の隠しチャットエフェクト(「おめでとう」で紙吹雪等) のメタデータ一覧を取得。
// 公式に発表されてない「このキーワードで何が発動するか」を全部出す。
//
//   bun run src/read/chat-effects.ts                      # 全カテゴリ
//   bun run src/read/chat-effects.ts --json
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: { json: { type: "boolean", default: false } },
});

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const talk = client.base.talk;

// categories 全部 (推定): 1..40 を列挙
const CATS = Array.from({ length: 40 }, (_, i) => i + 1);
const r: any = await talk.getChatEffectMetaList({ categories: CATS });
const dump = JSON.parse(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v));
if (opt.json) { console.log(JSON.stringify(dump, null, 2)); process.exit(0); }

const effects: any[] = dump?.chatEffectMetas ?? dump?.effects ?? [];
console.log(`チャットエフェクト ${effects.length} 件`);
for (const e of effects) {
	const kw = e?.keywords ?? e?.triggers ?? [];
	const name = e?.name ?? e?.effectName ?? "?";
	const cat = e?.category ?? "?";
	console.log(`  [${cat}] ${name}`.padEnd(40) + `  keywords: ${JSON.stringify(kw).slice(0, 120)}`);
}
process.exit(0);
