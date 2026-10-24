// VOOM 系の Follow/Follower 関係を取得する CLI。LINE では「友だち」とは別軸のフォロー関係がある。
//
//   bun run src/read/followers.ts followers         # 自分のフォロワー
//   bun run src/read/followers.ts following         # 自分がフォロー中
//   bun run src/read/followers.ts blacklist         # フォローブラックリスト
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const which = process.argv[2] ?? "followers";
if (!["followers", "following", "blacklist"].includes(which)) {
	console.error("usage: bun run src/read/followers.ts [followers|following|blacklist]");
	process.exit(1);
}

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

console.log(`[${me.displayName}] ${which}`);
try {
	let r: any;
	if (which === "followers") r = await talk.getFollowers({ getFollowersRequest: { followMid: { mid: me.mid } } });
	else if (which === "following") r = await talk.getFollowings({ getFollowingsRequest: { followMid: { mid: me.mid } } });
	else r = await talk.getFollowBlacklist({});
	const dump = JSON.parse(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v));
	const list: any[] = dump?.followers ?? dump?.followings ?? dump?.mids ?? dump?.list ?? [];
	console.log(`${list.length} 件`);
	console.log(JSON.stringify(dump, null, 2).slice(0, 2000));
} catch (e: any) { console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`); process.exit(1); }
process.exit(0);
