// inbox 監視 + ルール応答 CLI。ポーリングで新着メッセージを拾い、設定ルールに基づいて自動返信する。
// 設定: storage/autoreply-rules.json
//   [{"from": "<相手mid/box mid>?", "match": "正規表現", "reply": "返信本文", "once?": true, "cooldownSec?": 60}]
//
//   bun run src/read/autoresponder.ts                              # 全ルールで常駐、新着検知→応答
//   bun run src/read/autoresponder.ts --dry-run                    # マッチしても送信しない
//   POLL=15 bun run src/read/autoresponder.ts
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: { "dry-run": { type: "boolean", default: false } },
});
const POLL = Math.max(5, Number(process.env.POLL ?? 15));
const RULES_FILE = "./storage/autoreply-rules.json";
const STATE_FILE = "./storage/autoreply-state.json";

type Rule = { from?: string; match: string; reply: string; once?: boolean; cooldownSec?: number };
type State = { lastReply: Record<string, number>; replied: Record<string, boolean> };

const rules: Rule[] = existsSync(RULES_FILE) ? JSON.parse(readFileSync(RULES_FILE, "utf8")) : [];
const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { lastReply: {}, replied: {} };
if (rules.length === 0) {
	console.error(`${RULES_FILE} が無い or 空。例を書いて起動してください:\n[\n  { "match": "おはよう", "reply": "おはようございます！", "cooldownSec": 300 },\n  { "from": "ua5a17...", "match": "テスト", "reply": "受信確認(auto)", "once": true }\n]`);
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

console.log(`[${me.displayName}] autoresponder 起動 (POLL=${POLL}s, rules=${rules.length}, dry-run=${opt["dry-run"]})`);

const seen = new Set<string>();
let baseline = true;

async function tick() {
	let boxes: any[];
	try {
		const res: any = await talk.getMessageBoxes({
			messageBoxListRequest: { activeOnly: true, messageBoxCountLimit: 200, withUnreadCount: true, lastMessagesPerMessageBoxCount: 5, unreadOnly: true, lastOpRevision: 0n as any } as any,
			syncReason: "INTERNAL" as any,
		});
		boxes = res?.messageBoxes ?? [];
	} catch (e: any) { console.error(`poll err: ${String(e).slice(0, 150)}`); return; }

	const fresh: { from: string; box: string; text: string; id: string }[] = [];
	for (const b of boxes) {
		const boxId = String(b.id ?? "");
		for (const m of b.lastMessages ?? []) {
			const mid = String(m.id ?? "");
			if (!mid || seen.has(mid)) continue;
			if (String(m.from ?? "") === me.mid) { seen.add(mid); continue; }
			if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
			fresh.push({ from: String(m.from ?? ""), box: boxId, text: m.text ?? "", id: mid });
			seen.add(mid);
		}
	}
	if (baseline) { baseline = false; return; }

	for (const msg of fresh) {
		for (const [i, rule] of rules.entries()) {
			if (rule.from && rule.from !== msg.from && rule.from !== msg.box) continue;
			if (!new RegExp(rule.match).test(msg.text)) continue;
			const ruleKey = `rule${i}:${msg.box}`;
			if (rule.once && state.replied[ruleKey]) continue;
			const cd = rule.cooldownSec ?? 60;
			const last = state.lastReply[ruleKey] ?? 0;
			if (Date.now() - last < cd * 1000) continue;
			console.log(`[match] rule${i} from=${msg.from.slice(0,10)} text="${msg.text.slice(0,40)}" → reply="${rule.reply.slice(0,60)}"`);
			if (!opt["dry-run"]) {
				try {
					await talk.sendMessage({ to: msg.box, text: rule.reply, e2ee: process.env.ENC !== "0" } as any);
					state.lastReply[ruleKey] = Date.now();
					if (rule.once) state.replied[ruleKey] = true;
					writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
				} catch (e: any) { console.error(`  send err: ${JSON.stringify(e?.data ?? {}).slice(0, 200)}`); }
			}
			break;
		}
	}
}

await tick();
setInterval(tick, POLL * 1000);
