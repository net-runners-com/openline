// グループのトーク上部にピン留めされる「アナウンス」を投稿/取得/削除する CLI。
//
//   bun run src/write/announcement.ts <グループ名|mid>                           # list(既存アナウンス表示)
//   bun run src/write/announcement.ts <グループ名|mid> post "文言" --yes          # 投稿
//   bun run src/write/announcement.ts <グループ名|mid> remove <announcementSeq> --yes  # 削除
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { yes: { type: "boolean", short: "y", default: false } },
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length < 1) die(`usage: bun run src/write/announcement.ts <グループ名|mid> [post "文言" | remove <seq>] [--yes]`);
const [WHO, action, arg] = positionals;

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
console.log(`[${me.displayName}] グループ: ${chat.name} (${chat.mid})`);

if (!action || action === "list") {
	const r: any = await talk.getChatRoomAnnouncements({ chatRoomMids: [chat.mid] });
	const anns = r?.chatRoomAnnouncements ?? r?.announcements ?? [];
	console.log(`\nアナウンス: ${anns.length} 件`);
	console.log(JSON.stringify(anns, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 2000));
	process.exit(0);
}

if (action === "post") {
	if (!arg) die(`usage: ... post "<文言>" --yes`);
	console.log(`投稿内容: ${arg}`);
	if (!opt.yes) { console.log("[dry-run] 投稿するには --yes"); process.exit(0); }
	try {
		const r: any = await talk.createChatRoomAnnouncement({
			reqSeq: Number(await client.base.getReqseq("talk")),
			chatRoomMid: chat.mid,
			type: 1,  // TEXT = 1
			contents: { displayFields: 0, text: arg, link: "", thumbnail: "" },
		});
		console.log("✓ 投稿成功:", JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 300));
	} catch (e: any) { console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`); process.exit(1); }
	process.exit(0);
}

if (action === "remove") {
	if (!arg) die(`usage: ... remove <announcementSeq> --yes`);
	if (!opt.yes) { console.log("[dry-run] 削除するには --yes"); process.exit(0); }
	try {
		await talk.removeChatRoomAnnouncement({ reqSeq: Number(await client.base.getReqseq("talk")), chatRoomMid: chat.mid, announcementSeq: BigInt(arg) });
		console.log("✓ 削除成功");
	} catch (e: any) { console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`); process.exit(1); }
	process.exit(0);
}

die(`unknown action: ${action}`);
