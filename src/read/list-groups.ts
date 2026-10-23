// 参加しているグループ一覧
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached as string, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("ME:", me.displayName);
const talk = client.base.talk;

const ids: any = await talk.getAllChatMids({ request: { withMemberChats: true, withInvitedChats: false } });
const groupIds = (ids as any).memberChatMids ?? (ids as any).memberChatIds ?? [];
console.log("GROUPS:", groupIds.length);
for (let i = 0; i < groupIds.length; i += 30) {
	const slice = groupIds.slice(i, i + 30);
	try {
		const res: any = await talk.getChats({ chatMids: slice });
		const chats = res.chats ?? [];
		for (const g of chats) {
			const name = g.chatName ?? g.name ?? "?";
			const members = (g.extra?.groupExtra?.memberMids ?? g.members ?? []).length;
			console.log(`${g.chatMid ?? g.mid}\t${name}\tmembers=${members}`);
		}
	} catch (e) {
		console.error("getChats fail:", String(e).slice(0, 120));
	}
}
process.exit(0);
