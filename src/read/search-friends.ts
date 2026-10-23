// 友だち一覧から名前で検索。
//   bun run src/read/search-friends.ts <keyword>   表示名/メモに含むやつを出す
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const Q = (process.argv[2] ?? "").toLowerCase();
const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached as string, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("ME:", me.displayName);

const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
const mids: string[] = userFriendMids ?? [];
console.log("TOTAL:", mids.length);

for (let i = 0; i < mids.length; i += 20) {
	const res = await client.base.talk.getContactsV2({ mids: mids.slice(i, i + 20) });
	for (const [mid, entry] of Object.entries(res.contacts ?? {})) {
		const c = (entry as any)?.contact ?? {};
		const name = c.displayName ?? "";
		const over = c.displayNameOverridden ?? "";
		const hay = `${name} ${over}`.toLowerCase();
		if (!Q || hay.includes(Q)) {
			console.log(`${mid}\t${name}\t(${over})`);
		}
	}
}
process.exit(0);
