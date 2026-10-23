// 指定 mid が連絡先にあるか / 友だちか / 名前は何かを確認する
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const MID = process.argv[2];
if (!MID) { console.error("usage: bun run check-contact.ts <mid>"); process.exit(1); }
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached as string, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("ME:", me.displayName, me.mid);

const info = await client.base.talk.getContactsV2({ mids: [MID] });
console.log("CONTACT:", JSON.stringify(info.contacts, null, 2));

const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
const isFriend = (userFriendMids ?? []).includes(MID);
console.log("IS_FRIEND:", isFriend, "/ TOTAL_FRIENDS:", (userFriendMids ?? []).length);

// Try as room / group
try {
	const g = await client.base.talk.getGroup({ groupId: MID });
	console.log("GROUP:", JSON.stringify(g, null, 2));
} catch (e) { console.log("NOT_GROUP:", String(e).slice(0, 120)); }
process.exit(0);
