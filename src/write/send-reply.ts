// Reply / Mention 付きメッセージを送る CLI。send.ts の拡張版。
//
//   bun run src/write/send-reply.ts <相手> -t "返信本文" --reply <元messageId> --yes
//   bun run src/write/send-reply.ts <グループmid> -t "@太郎 おはよう" --mention 太郎=u1234... --yes
//   bun run src/write/send-reply.ts <グループmid> -t "@all 連絡" --mention all --yes
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		text: { type: "string", short: "t" },
		reply: { type: "string" },
		mention: { type: "string", multiple: true },  // "name=mid" or "all"
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1 || !opt.text) die(`usage: bun run src/write/send-reply.ts <相手|mid> -t "本文" [--reply <id>] [--mention name=mid|all]* [--yes]`);
const WHO = positionals[0];
const BODY = opt.text!;

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
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
	if (hits.length === 0) die(`「${WHO}」に一致なし`);
	if (hits.length > 1) die(`${hits.length} 人ヒット`);
	return hits[0];
}

const target = await resolveTo();

// Mention metadata を組み立て
const mentionees: Array<{ M?: string; A?: string; S: string; E: string }> = [];
for (const spec of (opt.mention ?? [])) {
	if (spec === "all") {
		// 本文内の "@all" を all mention にマップ
		const idx = BODY.indexOf("@all");
		if (idx < 0) die(`本文に "@all" が含まれてません`);
		mentionees.push({ A: "1", S: String(idx), E: String(idx + 4) });
	} else {
		const [name, mid] = spec.split("=");
		if (!name || !mid) die(`--mention は "@name=mid" or "all" 形式`);
		const idx = BODY.indexOf(`@${name}`);
		if (idx < 0) die(`本文に "@${name}" が含まれてません`);
		mentionees.push({ M: mid, S: String(idx), E: String(idx + name.length + 1) });
	}
}

const contentMetadata: Record<string, string> = {};
if (mentionees.length > 0) contentMetadata.MENTION = JSON.stringify({ MENTIONEES: mentionees });

console.log(`アカウント: ${me.displayName}`);
console.log(`宛先:     ${target.name} (${target.to})`);
console.log(`本文:     ${BODY}`);
if (opt.reply) console.log(`リプライ対象: messageId=${opt.reply}`);
if (mentionees.length > 0) console.log(`メンション: ${mentionees.length} 件`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes"); process.exit(0); }

try {
	await talk.sendMessage({
		to: target.to,
		text: BODY,
		contentType: "NONE",
		contentMetadata,
		relatedMessageId: opt.reply ?? undefined,
		messageRelationType: opt.reply ? "REPLY" : undefined,
		e2ee: process.env.ENC !== "0",
	} as any);
	console.log(`✓ 送信 → ${target.name}`);
} catch (e: any) {
	console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`);
	process.exit(1);
}
process.exit(0);
