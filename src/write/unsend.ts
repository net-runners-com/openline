// 個人LINE(linejs)で自分が送ったメッセージを送信取消する CLI。既定は dry-run(表示のみ)。
//
//   bun run unsend.ts <相手>                     # 自分の直近の送信を取消対象として表示するだけ
//   bun run unsend.ts <相手> --yes               # 自分の直近の送信を取消
//   bun run unsend.ts <相手> -m 売上 --yes        # 「売上」を含む自分の直近の送信を取消
//   bun run unsend.ts <相手> --id <messageId> --yes
//   bun run unsend.ts <相手> -n 50               # 遡る件数(既定 20)
//   ACCOUNT=sub bun run unsend.ts <相手> ...     # 別アカウント(storage.sub.json)で実行
//
// <相手> は表示名/自分が付けた名前の部分一致(大文字小文字無視)か mid(u.../c...)。
// 名前が複数ヒットしても、取消対象が見つかるトークが1つだけなら続行。2つ以上なら候補を出して止まる。
// LINE の送信取消は送信後24時間以内のみ。相手側には「送信を取り消しました」が残る。
// 未ログイン・トークン失効時は `bun run login-linejs.ts` で QR ログイン。

import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const USAGE = "usage: bun run unsend.ts <相手の名前|mid> [-m 文字列 | --id messageId] [-n 20] [--yes]";
const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		match: { type: "string", short: "m" },
		id: { type: "string" },
		scan: { type: "string", short: "n", default: "20" },
		yes: { type: "boolean", short: "y", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});
if (opt.help || positionals.length !== 1) {
	console.log(USAGE);
	process.exit(opt.help ? 0 : 1);
}
const WHO = positionals[0];
const SCAN = Number(opt.scan);
const MAX_CHATS = 10; // 名前がこれ以上ヒットしたら絞り込みを求める
const DAY_MS = 24 * 3600_000;
const I64_MAX = 9223372036854775807n;

function die(msg: string): never {
	console.error(msg);
	process.exit(1);
}

const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const LOGIN_CMD = `${process.env.ACCOUNT ? `ACCOUNT=${process.env.ACCOUNT} ` : ""}bun run login-linejs.ts`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})。\`${LOGIN_CMD}\` で QR ログインしてください。`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage }).catch((e) =>
	die(`ログイン失敗(トークン失効?)。\`${LOGIN_CMD}\` で再ログインしてください。\n${String(e).slice(0, 200)}`),
);
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log(`アカウント: ${me.displayName} (${STORAGE})`);
const talk = client.base.talk;
const e2ee = client.base.e2ee;

type Chat = { mid: string; name: string };
type Msg = { from?: string; id?: string; createdTime?: bigint | number; contentType?: string; text?: string | null; chunks?: unknown; contentMetadata?: Record<string, string> };

// --- 相手の解決 ---
async function resolveChats(): Promise<Chat[]> {
	if (/^[uc][0-9a-f]{32}$/.test(WHO)) return [{ mid: WHO, name: WHO }];
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const out: Chat[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const res = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(res.contacts ?? {})) {
			const c = (entry as { contact?: { displayName?: string; displayNameOverridden?: string } })?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) out.push({ mid, name });
		}
	}
	return out;
}

// --- 直近メッセージ(新→古, 復号済み) ---
async function recent(mid: string): Promise<Msg[]> {
	const res = await talk.getPreviousMessagesV2WithRequest({
		request: { messageBoxId: mid, endMessageId: { deliveredTime: BigInt(Date.now()) + 9_999_999n, messageId: I64_MAX }, messagesCount: SCAN, withReadCount: false, receivedOnly: false },
	});
	const msgs = (Array.isArray(res) ? res : ((res as { messages?: Msg[] }).messages ?? [])) as Msg[];
	for (const m of msgs) {
		if ((m.contentType === "NONE" || !m.text) && m.chunks) {
			try { await e2ee.decryptE2EEMessage(m); } catch { /* 復号不可はそのまま */ }
		}
	}
	return msgs;
}

const isMine = (m: Msg) => String(m.from ?? "") === me.mid;
const isUnsent = (m: Msg) => m.contentMetadata?.UNSENT === "true";
const matches = (m: Msg) =>
	isMine(m) && !isUnsent(m) && (opt.id ? String(m.id) === opt.id : opt.match ? String(m.text ?? "").includes(opt.match) : true);
const fmt = (m: Msg) =>
	`${isMine(m) ? "me " : "   "}${new Date(Number(m.createdTime ?? 0)).toLocaleString("ja-JP")}  ${isUnsent(m) ? "[取消済み]" : m.text ? m.text.replace(/\n/g, " ").slice(0, 60) : `[${m.contentType}]`}`;

const chats = await resolveChats();
if (chats.length === 0) die(`「${WHO}」に一致する友だちがいません。`);
if (chats.length > MAX_CHATS) die(`「${WHO}」が ${chats.length} 人にヒット。名前を絞るか mid を指定してください。`);

const found: { chat: Chat; target: Msg }[] = [];
for (const chat of chats) {
	const msgs = await recent(chat.mid).catch((e) => (console.error(`${chat.name}: 取得失敗 ${String(e).slice(0, 120)}`), [] as Msg[]));
	const target = msgs.find(matches);
	console.log(`\n== ${chat.name}  (${chat.mid})`);
	for (const m of msgs.slice(0, 5)) console.log(`${m === target ? "→" : " "} ${fmt(m)}`);
	if (target && !msgs.slice(0, 5).includes(target)) console.log(`→ ${fmt(target)}`);
	if (target) found.push({ chat, target });
}

if (found.length === 0) die(`\n取消対象なし(直近 ${SCAN} 件に条件に合う自分の送信がない)。`);
if (found.length > 1) die(`\n${found.length} 件のトークに取消対象あり。mid か -m で絞ってください:\n${found.map((f) => `  ${f.chat.mid}  ${f.chat.name}`).join("\n")}`);

const { chat, target } = found[0];
const label = `[${chat.name}] ${target.text ?? `[${target.contentType}]`} (id=${target.id})`;
if (Date.now() - Number(target.createdTime ?? 0) > DAY_MS) die(`\n送信から24時間を過ぎているため取消できません: ${label}`);
if (!opt.yes) {
	console.log(`\n[dry-run] 取消対象: ${label}\n実行するには --yes を付けてください。`);
	process.exit(0);
}
await talk.unsendMessage({ messageId: String(target.id) });
console.log(`\nUNSENT: ${label}`);
process.exit(0);
