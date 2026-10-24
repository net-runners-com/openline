// グループ招待URL(ChatTicket)を再発行する CLI。URL を知った人は LINE で開くとそのグループに参加する。
// `talk.reissueChatTicket` を叩くと ticket が更新され古い URL は無効になる。
//
//   bun run src/write/group-ticket.ts <グループ名|mid>              # dry-run (現在の ticket 表示)
//   bun run src/write/group-ticket.ts <グループ名|mid> --yes        # 再発行して新 URL 表示
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { yes: { type: "boolean", short: "y", default: false } },
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die(`usage: bun run src/write/group-ticket.ts <グループ名|mid> [--yes]`);
const WHO = positionals[0];

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

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
	if (hits.length === 0) die(`「${WHO}」に一致するグループなし`);
	if (hits.length > 1) die(`${hits.length} 件ヒット:\n${hits.map(h => `  ${h.mid}  ${h.name}`).join("\n")}`);
	return hits[0];
}

const chat = await resolveChat();
const info: any = await talk.getChats({ chatMids: [chat.mid] });
const g: any = info?.chats?.[0];
const existing = g?.extra?.groupExtra?.invitationTicket ?? "";
console.log(`アカウント: ${me.displayName}`);
console.log(`グループ:  ${chat.name} (${chat.mid})`);
console.log(`現在の invitationTicket: ${existing || "(未発行)"}`);
if (existing) console.log(`既存 URL: https://line.me/ti/g/${existing}`);
if (!opt.yes) { console.log("\n[dry-run] 再発行するには --yes を付けてください。"); process.exit(0); }

try {
	const r: any = await talk.reissueChatTicket({ request: { reqSeq: Number(await client.base.getReqseq("talk")), groupMid: chat.mid } });
	const ticket = r?.ticket ?? r?.ticketId ?? r;
	console.log(`\n再発行成功。`);
	console.log(`新 ticket: ${typeof ticket === "object" ? JSON.stringify(ticket) : ticket}`);
	console.log(`招待 URL: https://line.me/ti/g/${ticket}`);
} catch (e: any) {
	console.error(`再発行失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
