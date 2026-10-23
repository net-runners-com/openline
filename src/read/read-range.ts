// グループで「誰がどこまで読んだか」をメンバー単位で可視化する CLI。読み取り専用。
// `talk.getMessageReadRange` の生データを人間に読める形にして出す。
// LINE アプリの UI は「既読N」としか見せないが、裏では per-member の read 範囲が取れる。
//
//   bun run src/read/read-range.ts <グループ名|mid>        # 名前は部分一致
//   bun run src/read/read-range.ts c5b3cba8...             # mid 直接指定
//   bun run src/read/read-range.ts --list                  # グループ一覧(前方互換)
//   N=20 bun run src/read/read-range.ts <...>              # 直近 N 件まで遡って unread 範囲を推定(既定 20)
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const WHO = process.argv[2];
if (!WHO) { console.error("usage: bun run src/read/read-range.ts <グループ名|mid>"); process.exit(1); }
const N = Number(process.env.N ?? 20);

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;
const e2ee = client.base.e2ee;

// 対象グループを特定
async function resolveChat(): Promise<{ mid: string; name: string }> {
	if (/^c[0-9a-f]{32}$/.test(WHO)) {
		const r: any = await talk.getChats({ chatMids: [WHO] });
		return { mid: WHO, name: r?.chats?.[0]?.chatName || WHO.slice(0, 10) };
	}
	const all: any = await talk.getAllChatMids({ request: { withMemberChats: true, withInvitedChats: false } });
	const mids: string[] = all?.memberChatMids ?? all?.memberChatIds ?? [];
	const q = WHO.toLowerCase();
	const hits: { mid: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 30) {
		const r: any = await talk.getChats({ chatMids: mids.slice(i, i + 30) });
		for (const c of r?.chats ?? []) {
			const name = String(c.chatName ?? c.name ?? "");
			if (name.toLowerCase().includes(q)) hits.push({ mid: String(c.chatMid ?? c.mid), name });
		}
	}
	if (hits.length === 0) { console.error(`「${WHO}」に一致するグループなし`); process.exit(1); }
	if (hits.length > 1) { console.error(`${hits.length} 件ヒット:\n${hits.map(h => `  ${h.mid}  ${h.name}`).join("\n")}`); process.exit(1); }
	return hits[0];
}

const chat = await resolveChat();
console.log(`[${me.displayName}] グループ: ${chat.name} (${chat.mid})\n`);

// メンバー名解決: getChats(withMembers)が displayName を含まないケースがあるので、
// 既読範囲側で出てきた mids を getContactsV2 でまとめて名前解決する(後述)
const names = new Map<string, string>();
async function resolveNames(mids: string[]) {
	const todo = mids.filter((m) => !names.has(m));
	for (let i = 0; i < todo.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: todo.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			names.set(mid, c.displayNameOverridden || c.displayName || mid.slice(0, 10));
		}
	}
}

// 既読範囲
const rr: any = await talk.getMessageReadRange({ chatIds: [chat.mid], syncReason: "INTERNAL" as any });
const entry = Array.isArray(rr) ? rr[0] : rr?.success?.[0];
if (!entry) { console.log("ReadRange なし(メッセージ未投稿? or 権限なし)"); process.exit(0); }
const ranges: Record<string, Record<string, { 1: any; 2: any; 3: any; 4: any }>> = entry.ranges ?? {};

// 直近メッセージ(最新数件)を取って "グループで最新の messageId" を知る
// chatMid を含む 1件だけ要求して直近を知る方式
const boxRes: any = await talk.getMessageBoxes({
	messageBoxListRequest: {
		activeOnly: false, messageBoxCountLimit: 200,
		withUnreadCount: false, lastMessagesPerMessageBoxCount: Math.max(1, Math.min(N, 10)),
		unreadOnly: false, lastOpRevision: 0n as any,
	} as any,
	syncReason: "INTERNAL" as any,
});
const box = (boxRes?.messageBoxes ?? []).find((b: any) => String(b.id) === chat.mid);
const msgs: any[] = (box?.lastMessages ?? []).slice().sort((a: any, b: any) => Number(BigInt(a.createdTime ?? 0) - BigInt(b.createdTime ?? 0)));
if (msgs.length === 0) {
	console.log("直近メッセージが取れなかった（長期間非アクティブ or サーバー保存期間切れ）。既読範囲データのみ表示します。\n");
}
for (const m of msgs) {
	if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
}
const latest = msgs[msgs.length - 1];
const latestId = latest ? BigInt(latest.id) : 0n;
if (latest) {
	console.log(`直近メッセージ (${msgs.length} 件、最新 → id=${String(latestId)}):`);
	for (const m of msgs.slice(-5)) {
		const sender = names.get(String(m.from)) || (String(m.from) === me.mid ? "自分" : String(m.from).slice(0, 10));
		const t = new Date(Number(m.createdTime)).toLocaleString("ja-JP");
		const body = m.text ? m.text.replace(/\n/g, " ").slice(0, 60) : `[${m.contentType}]`;
		console.log(`  ${t}  ${sender}: ${body}`);
	}
	console.log("");
}

// 名前解決(range に出た mids + chat members)
await resolveNames(Object.keys(ranges));

// 各メンバーの既読状況
console.log("メンバー別既読:");
const seen = new Set<string>();
for (const [mid, memberRanges] of Object.entries(ranges)) {
	seen.add(mid);
	const endIds = Object.values(memberRanges).map(r => BigInt(String((r as any)[2])));
	const endTimes = Object.values(memberRanges).map(r => Number((r as any)[4]));
	const lastReadId = endIds.length ? endIds.reduce((a, b) => a > b ? a : b) : 0n;
	const lastReadTime = endTimes.length ? Math.max(...endTimes) : 0;
	const name = names.get(mid) || mid.slice(0, 10);
	let label: string;
	if (latestId === 0n) label = `(最新ID不明)  最後の既読 id=${String(lastReadId)}`;
	else label = (lastReadId >= latestId) ? "✓ 最新まで既読" : `✗ 未読あり (${String(latestId - lastReadId)} ID 差)`;
	const t = lastReadTime ? new Date(lastReadTime).toLocaleString("ja-JP") : "-";
	console.log(`  ${name.padEnd(18)} ${label}  @${t}`);
}
process.exit(0);
