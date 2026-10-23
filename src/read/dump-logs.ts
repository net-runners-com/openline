// 個人LINE(linejs)のトーク履歴を吸い出して JSONL/JSON で保存する。
// 営業DM(表示名メモに "jn" タグ)を送った相手のログ収集が主目的。全友だちも可。
//
//   bun run src/read/dump-logs.ts               # "jn" タグの相手だけ(既定)
//   TAG= bun run src/read/dump-logs.ts          # TAG 空 → 全友だち
//   PER=300 bun run src/read/dump-logs.ts       # 1トークあたり最大取得件数(既定 300)
//   OUTDIR=out/foo bun run src/read/dump-logs.ts
//   ACCOUNT=sub bun run src/read/dump-logs.ts   # 別アカウント(storage/sub.json)で実行
//
// 出力(既定 ./out/oplogs-<ts>/): messages.jsonl(1行1メッセージ, 復号済み) と contacts.json。
// E2EE メッセージは client.base.e2ee で復号。読み取りのみ・送信はしない。
// 個人アカウントの非公式操作なので取得しすぎ注意(レート/凍結)。

import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { mkdirSync } from "node:fs";

const TAG = process.env.TAG ?? "jn";
const PER = Number(process.env.PER ?? 300); // 1トークの上限
const PAGE = 50; // 1回のAPI取得件数
const GAP_MS = Number(process.env.GAP_MS ?? 700);
const OUTDIR = process.env.OUTDIR ?? `./out/oplogs-${Date.now()}`;
const I64_MAX = 9223372036854775807n;

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const LOGIN_CMD = `${process.env.ACCOUNT ? `ACCOUNT=${process.env.ACCOUNT} ` : ""}bun run src/auth/login-linejs.ts`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") throw new Error(`未ログイン(${STORAGE})。\`${LOGIN_CMD}\` で QR ログインしてください。`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("LOGGED_IN_AS:", me.displayName, me.mid);

mkdirSync(OUTDIR, { recursive: true });
const talk = client.base.talk;
const e2ee = client.base.e2ee;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasTag = (s: string) => !TAG || s.toLowerCase().includes(TAG.toLowerCase());

// --- 対象コンタクト収集 ---
const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
const mids: string[] = userFriendMids ?? [];
type Contact = { mid: string; displayName: string; overridden: string };
const targets: Contact[] = [];
for (let i = 0; i < mids.length; i += 20) {
	const res = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
	for (const [mid, entry] of Object.entries(res.contacts ?? {})) {
		const c = (entry as { contact?: { displayName?: string; displayNameOverridden?: string } })?.contact ?? {};
		const overridden = c.displayNameOverridden ?? "";
		const displayName = c.displayName ?? overridden;
		if (hasTag(overridden) || hasTag(displayName)) targets.push({ mid, displayName, overridden });
	}
}
await Bun.write(`${OUTDIR}/contacts.json`, JSON.stringify(targets, null, 2));
console.log(`対象 ${targets.length} 件 (TAG="${TAG}") → ${OUTDIR}`);

// --- 1トークの履歴を最新から遡って取得(ページング) ---
type Raw = { from?: string; to?: string; id?: string; createdTime?: bigint | number; deliveredTime?: bigint | number; contentType?: string; text?: string | null; chunks?: unknown };
async function fetchThread(mid: string): Promise<Raw[]> {
	const out: Raw[] = [];
	let end = { deliveredTime: BigInt(Date.now()) + 9_999_999n, messageId: I64_MAX };
	const seen = new Set<string>();
	while (out.length < PER) {
		const res = await talk.getPreviousMessagesV2WithRequest({
			request: { messageBoxId: mid, endMessageId: end, messagesCount: PAGE, withReadCount: false, receivedOnly: false },
		});
		const msgs = (Array.isArray(res) ? res : ((res as { messages?: Raw[] }).messages ?? [])) as Raw[];
		if (msgs.length === 0) break;
		let progressed = false;
		for (const m of msgs) {
			const id = String(m.id ?? "");
			if (id && seen.has(id)) continue;
			if (id) seen.add(id);
			progressed = true;
			// E2EE 復号(失敗は握りつぶし、text=null のまま残す)
			if ((m.contentType === "NONE" || !m.text) && m.chunks) {
				try { await e2ee.decryptE2EEMessage(m); } catch { /* 復号不可はそのまま */ }
			}
			out.push(m);
		}
		if (!progressed) break;
		// 最古メッセージを次の end に
		const oldest = msgs[msgs.length - 1];
		if (!oldest?.id) break;
		end = { deliveredTime: BigInt(oldest.deliveredTime ?? 0), messageId: BigInt(oldest.id) };
	}
	return out.slice(0, PER);
}

const norm = (m: Raw, t: Contact) => ({
	mid: t.mid,
	name: t.displayName,
	label: t.overridden,
	direction: String(m.from ?? "") === me.mid ? "out" : "in",
	from: String(m.from ?? ""),
	to: String(m.to ?? ""),
	contentType: m.contentType ?? null,
	text: m.text ?? null,
	createdTime: m.createdTime != null ? String(m.createdTime) : null,
	createdAt: m.createdTime != null ? new Date(Number(m.createdTime)).toISOString() : null,
	id: m.id != null ? String(m.id) : null,
});

let total = 0;
const lines: string[] = [];
for (const [idx, t] of targets.entries()) {
	try {
		const raw = await fetchThread(t.mid);
		// 時系列(古→新)に並べ替え
		raw.sort((a, b) => Number(BigInt(a.createdTime ?? 0) - BigInt(b.createdTime ?? 0)));
		for (const m of raw) { lines.push(JSON.stringify(norm(m, t))); total++; }
		const replies = raw.filter((m) => String(m.from ?? "") !== me.mid).length;
		console.log(`${idx + 1}/${targets.length} ${t.displayName}: ${raw.length} msgs (返信 ${replies})`);
	} catch (e) {
		console.log(`${idx + 1}/${targets.length} ${t.displayName}: FAIL ${String(e).slice(0, 120)}`);
	}
	if (idx < targets.length - 1) await sleep(GAP_MS);
}
await Bun.write(`${OUTDIR}/messages.jsonl`, lines.join("\n") + "\n");
console.log(`\n合計 ${total} メッセージ → ${OUTDIR}/messages.jsonl`);
console.log(`相手一覧 → ${OUTDIR}/contacts.json`);
process.exit(0);
