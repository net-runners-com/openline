// 個人LINE(linejs)でメッセージを送る CLI。既定は dry-run(送らず表示のみ)。--yes で実送信。
//
//   bun run send.ts <相手> -t "本文"            # dry-run(送信内容を表示)
//   bun run send.ts <相手> -t "本文" --yes       # 送信
//   bun run send.ts <相手> -f draft.txt --yes    # ファイルの中身を送信
//   ACCOUNT=sub2 bun run send.ts <相手> ...      # 別アカウント
//
// <相手> は表示名の部分一致(友だち)か mid。グループ(c...)は名前解決できないので mid を直接指定。
// 送信取消は bun run unsend.ts <相手> --yes(24時間以内)。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		text: { type: "string", short: "t" },
		file: { type: "string", short: "f" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die('usage: bun run send.ts <相手の名前|mid> (-t "本文" | -f file) [--yes]');
const WHO = positionals[0];
const body = opt.file ? (await Bun.file(opt.file).text()).replace(/\n+$/, "") : opt.text;
if (!body) die("本文がありません(-t か -f で指定)。");

const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})。login-linejs.ts でログインしてください。`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage }).catch((e) =>
	die(`ログイン失敗(トークン失効?)。再ログインしてください。\n${String(e).slice(0, 200)}`));
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

// 相手の解決: mid ならそのまま。名前なら友だちから部分一致(1件のみ)
async function resolveTo(): Promise<{ to: string; name: string; isGroup: boolean }> {
	if (/^[uc][0-9a-f]{32}$/.test(WHO)) return { to: WHO, name: WHO.slice(0, 12), isGroup: WHO[0] === "c" };
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: { to: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const res = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(res.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) hits.push({ to: mid, name });
		}
	}
	if (hits.length === 0) die(`「${WHO}」に一致する友だちがいません(グループは mid で指定)。`);
	if (hits.length > 1) die(`「${WHO}」が ${hits.length} 人にヒット。mid で指定してください:\n${hits.map((h) => `  ${h.to}  ${h.name}`).join("\n")}`);
	return { ...hits[0], isGroup: false };
}

const { to, name, isGroup } = await resolveTo();
console.log(`アカウント: ${me.displayName}\n宛先: ${name} (${to})\n---\n${body}\n---`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

// LINE の DM/グループとも E2EE が既定(平文を要求されたら ENC=0)。linejs が鍵共有を処理する
const useE2ee = process.env.ENC !== "0";
await talk.sendMessage({ to, text: body, e2ee: useE2ee } as any);
console.log(`送信しました → ${name}`);
process.exit(0);
