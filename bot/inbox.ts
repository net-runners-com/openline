// 個人LINE(linejs)の未読/新着メッセージを見る CLI。読み取りのみ・既読はつけない。
//
//   bun run inbox.ts                 # メイン(storage.json)を監視。届いたメッセージを表示し続ける
//   ACCOUNT=sub2 bun run inbox.ts    # 別アカウント(storage.sub2.json)を監視
//   NAMES=1 bun run inbox.ts         # 送信者を mid でなく表示名で出す(初回に連絡先を取得)
//
// client.listen() の push/long-polling で受信イベントを拾う。既読(sendChatChecked)は呼ばないので、
// スマホ側の未読は未読のまま残る。Ctrl-C で終了。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const LOGIN = `${process.env.ACCOUNT ? `ACCOUNT=${process.env.ACCOUNT} ` : ""}bun run login-linejs.ts`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})。\`${LOGIN}\` でログインしてください。`); process.exit(1); }
const client = await loginWithAuthToken(cached, { device: "DESKTOPWIN" as const, storage }).catch((e) => {
	console.error(`ログイン失敗(トークン失効?)。\`${LOGIN}\` で再ログイン。\n${String(e).slice(0, 200)}`); process.exit(1);
});
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log(`[${me.displayName}] の新着を監視中… (既読はつけません, Ctrl-C で終了)\n`);

// 送信者名の解決(NAMES=1 のときだけ, 都度キャッシュ)
const names = new Map<string, string>();
async function nameOf(mid: string): Promise<string> {
	if (!process.env.NAMES) return mid.slice(0, 10);
	if (names.has(mid)) return names.get(mid)!;
	try {
		const res = await client.base.talk.getContactsV2({ mids: [mid] });
		const c = (Object.values(res.contacts ?? {})[0] as { contact?: { displayName?: string; displayNameOverridden?: string } })?.contact ?? {};
		names.set(mid, c.displayNameOverridden || c.displayName || mid.slice(0, 10));
	} catch { names.set(mid, mid.slice(0, 10)); }
	return names.get(mid)!;
}

client.on("message", async (msg: any) => {
	const r = msg.raw ?? msg;
	if (String(r.from ?? "") === me.mid) return; // 自分の送信は無視
	const who = await nameOf(String(r.from ?? ""));
	const time = new Date(Number(r.createdTime ?? Date.now())).toLocaleString("ja-JP");
	const body = r.text ? r.text.replace(/\n/g, " ") : `[${r.contentType ?? "?"}]`;
	console.log(`${time}  ${who}: ${body}`);
});

client.listen({ talk: true, square: false });
