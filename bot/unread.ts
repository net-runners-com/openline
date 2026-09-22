// 個人LINE(linejs)で「未読が溜まっているトーク」の一覧を出す CLI。読み取りのみ・既読はつけない。
//
//   bun run unread.ts                # メイン(storage.json)の未読トーク一覧
//   ACCOUNT=sub2 bun run unread.ts   # 別アカウント
//   N=5 bun run unread.ts            # 各トークの直近メッセージ表示件数(既定 3)
//
// getMessageBoxes(unreadOnly) で未読数つきのメッセージボックスを取得し、相手名・未読数・
// 直近メッセージ(E2EE 復号)を表示する。sendChatChecked は呼ばないので未読は未読のまま。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const LOGIN = `${process.env.ACCOUNT ? `ACCOUNT=${process.env.ACCOUNT} ` : ""}bun run login-linejs.ts`;
const N = Number(process.env.N ?? 3);
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})。\`${LOGIN}\` でログインしてください。`); process.exit(1); }
const client = await loginWithAuthToken(cached, { device: "DESKTOPWIN" as const, storage }).catch((e) => {
	console.error(`ログイン失敗(トークン失効?)。\`${LOGIN}\` で再ログイン。\n${String(e).slice(0, 200)}`); process.exit(1);
});
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;
const e2ee = client.base.e2ee;

// 未読のみ・未読数つき・各ボックス直近 N 件
const res: any = await talk.getMessageBoxes({
	// minChatId/maxChatId は送らない(空文字を渡すと 0 件になる)
	messageBoxListRequest: {
		activeOnly: true, messageBoxCountLimit: 200,
		withUnreadCount: true, lastMessagesPerMessageBoxCount: N, unreadOnly: true, lastOpRevision: 0n as any,
	} as any,
	syncReason: "INTERNAL" as any,
});
const boxes: any[] = res?.messageBoxes ?? [];

// 相手名の解決(u.. は連絡先, c.. はグループ)
async function nameOf(id: string): Promise<string> {
	try {
		if (id.startsWith("c")) {
			const r: any = await talk.getChats({ request: { chatMids: [id], withMembers: false, withInvitees: false }, syncReason: "INTERNAL" as any });
			return r?.chats?.[0]?.chatName || id.slice(0, 10);
		}
		const r: any = await talk.getContactsV2({ mids: [id] });
		const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
		return c.displayNameOverridden || c.displayName || id.slice(0, 10);
	} catch { return id.slice(0, 10); }
}

if (boxes.length === 0) { console.log(`[${me.displayName}] 未読のトークはありません。`); process.exit(0); }
console.log(`[${me.displayName}] 未読 ${boxes.length} 件:\n`);
for (const b of boxes) {
	const name = await nameOf(String(b.id));
	console.log(`● ${name}  (未読 ${b.unreadCount})`);
	const msgs = [...(b.lastMessages ?? [])].sort((x: any, y: any) => Number(BigInt(x.createdTime ?? 0) - BigInt(y.createdTime ?? 0)));
	for (const m of msgs) {
		if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
		const mine = String(m.from ?? "") === me.mid;
		const time = new Date(Number(m.createdTime ?? 0)).toLocaleString("ja-JP");
		const body = m.text ? m.text.replace(/\n/g, " ").slice(0, 80) : `[${m.contentType}]`;
		console.log(`   ${mine ? "自分" : "相手"} ${time}  ${body}`);
	}
	console.log("");
}
process.exit(0);
