// 相手ごとに「どのアカから返信するか」をルーティングして送る CLI。実質 Multi Profile の代替。
// 設定: storage/routing.json  例: {"ua5a17...": "sub1", "ub1234...": "main"}
// 友だち名でもルーティング可能(初回に mid 解決してキャッシュ)。
//
//   bun run src/write/route-send.ts <相手> -t "本文" --yes          # 設定済みアカから送信
//   bun run src/write/route-send.ts set <相手> <account>            # ルーティング登録 (main/sub1/sub2)
//   bun run src/write/route-send.ts list                            # 現在のルーティング表示
//   bun run src/write/route-send.ts unset <相手>                     # 解除
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ROUTING_FILE = "./storage/routing.json";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		text: { type: "string", short: "t" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }

type Routing = Record<string, string>; // mid or name key → account name
const loadRouting = (): Routing => existsSync(ROUTING_FILE) ? JSON.parse(readFileSync(ROUTING_FILE, "utf8")) : {};
const saveRouting = (r: Routing) => writeFileSync(ROUTING_FILE, JSON.stringify(r, null, 2));

const cmd = positionals[0];

// --- subcommands: list / set / unset ---
if (cmd === "list") {
	const r = loadRouting();
	console.log(`ルーティング設定 (${Object.keys(r).length} 件):`);
	for (const [key, acc] of Object.entries(r)) console.log(`  ${key.padEnd(40)} → ${acc}`);
	process.exit(0);
}
if (cmd === "set") {
	const [, who, acc] = positionals;
	if (!who || !acc) die(`usage: ... set <mid|名前> <main|sub1|sub2>`);
	const r = loadRouting();
	r[who] = acc;
	saveRouting(r);
	console.log(`set: ${who} → ${acc}`);
	process.exit(0);
}
if (cmd === "unset") {
	const [, who] = positionals;
	if (!who) die(`usage: ... unset <mid|名前>`);
	const r = loadRouting();
	delete r[who];
	saveRouting(r);
	console.log(`unset: ${who}`);
	process.exit(0);
}

// --- default: send ---
if (positionals.length !== 1 || !opt.text) die(`usage: bun run src/write/route-send.ts <相手> -t "本文" [--yes]
  または: list / set <相手> <account> / unset <相手>`);
const WHO = positionals[0];
const BODY = opt.text!;

const routing = loadRouting();
// WHO が mid っぽければ直接 lookup、名前なら部分一致
let account: string | undefined;
if (/^[uc][0-9a-f]{32}$/.test(WHO)) {
	account = routing[WHO];
} else {
	// 名前での登録を優先、無ければ全キー linear search
	account = routing[WHO];
	if (!account) {
		for (const [k, v] of Object.entries(routing)) {
			if (!/^[uc][0-9a-f]{32}$/.test(k) && k.toLowerCase().includes(WHO.toLowerCase())) { account = v; break; }
		}
	}
}
if (!account) die(`「${WHO}」のルーティング未設定。'set' で登録してください。
  例: bun run src/write/route-send.ts set ${WHO} sub1`);

console.log(`経路: アカウント "${account}" で ${WHO} に送信`);

// 指定アカウントで login
const STORAGE = `./storage/${account}.json`;
if (!existsSync(STORAGE)) die(`storage ファイルなし: ${STORAGE}`);
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`${account} 未ログイン(${STORAGE})`);
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

async function resolveTo(): Promise<{ to: string; name: string }> {
	if (/^[uc][0-9a-f]{32}$/.test(WHO)) return { to: WHO, name: WHO.slice(0, 12) };
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: { to: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) hits.push({ to: mid, name });
		}
	}
	if (hits.length === 0) die(`${account} のアドレス帳に「${WHO}」なし`);
	if (hits.length > 1) die(`${hits.length} 人ヒット`);
	return hits[0];
}

const target = await resolveTo();
console.log(`アカウント: ${me.displayName}  (storage ${account})`);
console.log(`宛先:     ${target.name} (${target.to})`);
console.log(`本文:     ${BODY}`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes"); process.exit(0); }

try {
	await talk.sendMessage({ to: target.to, text: BODY, e2ee: process.env.ENC !== "0" } as any);
	console.log(`✓ 送信 (as ${me.displayName}) → ${target.name}`);
} catch (e: any) {
	console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`);
	process.exit(1);
}
process.exit(0);
