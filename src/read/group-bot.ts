// グループ運営自動化 CLI。参加/退出イベントで歓迎メッセージ、キーワード検知でアナウンス投稿、等。
// autoresponder.ts と似た常駐型だが、グループ特化のイベントハンドリング。
//
// 設定: storage/group-bot-rules.json
//   {
//     "<groupMid>": {
//       "welcome": "〜さん、ようこそ！グループ説明...",             // 新規メンバー歓迎
//       "farewell": "〜さん、お疲れさまでした",                     // 退出時
//       "keywords": [{"match": "ヘルプ", "reply": "FAQ: ..."}]      // キーワード応答
//     }
//   }
//
//   bun run src/read/group-bot.ts                 # 全グループを監視
//   bun run src/read/group-bot.ts --dry-run       # マッチしても送信しない
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: { "dry-run": { type: "boolean", default: false } },
});
const POLL = Math.max(5, Number(process.env.POLL ?? 15));
const RULES_FILE = "./storage/group-bot-rules.json";

type GroupRules = { welcome?: string; farewell?: string; keywords?: { match: string; reply: string }[] };
const config: Record<string, GroupRules> = existsSync(RULES_FILE) ? JSON.parse(readFileSync(RULES_FILE, "utf8")) : {};
if (Object.keys(config).length === 0) {
	console.error(`${RULES_FILE} 無い or 空。例:
{
  "c07734051db355112f536f433539e669a": {
    "welcome": "ようこそ！このグループは openline 開発用です。",
    "keywords": [{"match": "help|ヘルプ", "reply": "詳細は README を見てください"}]
  }
}`);
	process.exit(1);
}

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;
const e2ee = client.base.e2ee;

console.log(`[${me.displayName}] group-bot 起動 (POLL=${POLL}s, groups=${Object.keys(config).length}, dry-run=${opt["dry-run"]})`);

const seen = new Set<string>();
let baseline = true;

async function nameOf(mid: string): Promise<string> {
	try {
		const r: any = await talk.getContactsV2({ mids: [mid] });
		const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
		return c.displayNameOverridden || c.displayName || mid.slice(0, 10);
	} catch { return mid.slice(0, 10); }
}

async function send(to: string, text: string) {
	if (opt["dry-run"]) { console.log(`  [dry] send to ${to.slice(0,10)}: ${text.slice(0, 80)}`); return; }
	try {
		await talk.sendMessage({ to, text, e2ee: process.env.ENC !== "0" } as any);
		console.log(`  ✓ send → ${to.slice(0,10)}`);
	} catch (e: any) { console.error(`  send err: ${JSON.stringify(e?.data ?? {}).slice(0, 150)}`); }
}

async function tick() {
	let boxes: any[];
	try {
		const res: any = await talk.getMessageBoxes({
			messageBoxListRequest: { activeOnly: true, messageBoxCountLimit: 200, withUnreadCount: true, lastMessagesPerMessageBoxCount: 10, unreadOnly: true, lastOpRevision: 0n as any } as any,
			syncReason: "INTERNAL" as any,
		});
		boxes = res?.messageBoxes ?? [];
	} catch (e: any) { console.error(`poll err: ${String(e).slice(0, 100)}`); return; }

	type Fresh = { from: string; box: string; text: string; type: string; locKey?: string; locArgs?: string };
	const fresh: Fresh[] = [];
	for (const b of boxes) {
		const boxId = String(b.id ?? "");
		if (!boxId.startsWith("c")) continue;
		if (!config[boxId]) continue;
		for (const m of b.lastMessages ?? []) {
			const mid = String(m.id ?? "");
			if (!mid || seen.has(mid)) continue;
			if (String(m.from ?? "") === me.mid) { seen.add(mid); continue; }
			if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
			fresh.push({
				from: String(m.from ?? ""), box: boxId, text: m.text ?? "", type: m.contentType ?? "",
				locKey: m.contentMetadata?.LOC_KEY, locArgs: m.contentMetadata?.LOC_ARGS,
			});
			seen.add(mid);
		}
	}
	if (baseline) { baseline = false; return; }

	for (const msg of fresh) {
		const rules = config[msg.box];
		if (!rules) continue;
		// Welcome: C_MJ = member joined, LOC_ARGS に新メンバーの mid
		if (msg.type === "CHATEVENT" && msg.locKey === "C_MJ" && rules.welcome) {
			const joined = msg.locArgs ?? "";
			const name = await nameOf(joined);
			const text = rules.welcome.replace(/{name}/g, name).replace(/～さん/g, `${name}さん`).replace(/〜さん/g, `${name}さん`);
			console.log(`[welcome] group=${msg.box.slice(0,10)} joined=${name}`);
			await send(msg.box, text);
		}
		// Farewell: C_ML = member left
		if (msg.type === "CHATEVENT" && (msg.locKey === "C_ML" || msg.locKey === "C_MR") && rules.farewell) {
			const name = await nameOf(msg.locArgs ?? "");
			const text = rules.farewell.replace(/{name}/g, name).replace(/～さん/g, `${name}さん`).replace(/〜さん/g, `${name}さん`);
			console.log(`[farewell] group=${msg.box.slice(0,10)} left=${name}`);
			await send(msg.box, text);
		}
		// Keywords
		for (const kw of rules.keywords ?? []) {
			if (new RegExp(kw.match).test(msg.text)) {
				console.log(`[keyword] group=${msg.box.slice(0,10)} match="${kw.match}" text="${msg.text.slice(0,40)}"`);
				await send(msg.box, kw.reply);
				break;
			}
		}
	}
}

await tick();
setInterval(tick, POLL * 1000);
