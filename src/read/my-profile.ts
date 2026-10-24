// 自分の拡張プロフィール (誕生日 / 公開設定 など) を取得する CLI。
// `talk.getExtendedProfile` (無引数) で返るデータ。
//
//   bun run src/read/my-profile.ts
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();

const r: any = await client.base.request.request([], "getExtendedProfile", 4, true, "/S4");
console.log(`[${me.displayName}] 拡張プロフィール:`);
console.log(JSON.stringify({
	mid: me.mid,
	displayName: me.displayName,
	statusMessage: (me as any).statusMessage,
	picturePath: (me as any).picturePath,
	userid: (me as any).userid,
	extended: r,
}, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
process.exit(0);
