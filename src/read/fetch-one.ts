// 単一相手(mid)のトーク履歴だけを取ってきて jsonl にする。dump-logs.ts の縮小版。
//   bun run src/read/fetch-one.ts <mid> [per]
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { mkdirSync } from "node:fs";

const MID = process.argv[2];
if (!MID) { console.error("usage: bun run src/read/fetch-one.ts <mid> [per]"); process.exit(1); }
const PER = Number(process.argv[3] ?? 500);
const PAGE = 50;
const I64_MAX = 9223372036854775807n;
const OUTDIR = `./out/one-${MID.slice(0, 8)}-${Date.now()}`;

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") throw new Error(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("LOGGED_IN_AS:", me.displayName, me.mid);

mkdirSync(OUTDIR, { recursive: true });
const talk = client.base.talk;
const e2ee = client.base.e2ee;

const info = await talk.getContactsV2({ mids: [MID] });
const c = (Object.values(info.contacts ?? {})[0] as any)?.contact ?? {};
console.log("TARGET:", c.displayName ?? "?", "/", c.displayNameOverridden ?? "", MID);

type Raw = { from?: string; to?: string; id?: string; createdTime?: bigint | number; deliveredTime?: bigint | number; contentType?: string; text?: string | null; chunks?: unknown };
const out: Raw[] = [];
let end = { deliveredTime: BigInt(Date.now()) + 9_999_999n, messageId: I64_MAX };
const seen = new Set<string>();
while (out.length < PER) {
	const res = await talk.getPreviousMessagesV2WithRequest({
		request: { messageBoxId: MID, endMessageId: end, messagesCount: PAGE, withReadCount: false, receivedOnly: false },
	});
	const msgs = (Array.isArray(res) ? res : ((res as { messages?: Raw[] }).messages ?? [])) as Raw[];
	if (msgs.length === 0) break;
	let progressed = false;
	for (const m of msgs) {
		const id = String(m.id ?? "");
		if (id && seen.has(id)) continue;
		if (id) seen.add(id);
		progressed = true;
		if ((m.contentType === "NONE" || !m.text) && m.chunks) {
			try { await e2ee.decryptE2EEMessage(m); } catch {}
		}
		out.push(m);
	}
	if (!progressed) break;
	const oldest = msgs[msgs.length - 1];
	if (!oldest?.id) break;
	end = { deliveredTime: BigInt(oldest.deliveredTime ?? 0), messageId: BigInt(oldest.id) };
}
out.sort((a, b) => Number(BigInt(a.createdTime ?? 0) - BigInt(b.createdTime ?? 0)));

const lines = out.map((m) => JSON.stringify({
	direction: String(m.from ?? "") === me.mid ? "out" : "in",
	from: String(m.from ?? ""),
	to: String(m.to ?? ""),
	contentType: m.contentType ?? null,
	text: m.text ?? null,
	createdAt: m.createdTime != null ? new Date(Number(m.createdTime)).toISOString() : null,
	id: m.id != null ? String(m.id) : null,
}));
await Bun.write(`${OUTDIR}/messages.jsonl`, lines.join("\n") + "\n");
console.log(`${out.length} msgs → ${OUTDIR}/messages.jsonl`);
process.exit(0);
