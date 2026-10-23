// 個人LINE(linejs)で友だちの表示名(メモ名/オーバーライド)を変える CLI。既定は dry-run。
// 自分のアドレス帳上の呼び方だけ変わる。相手にも、友だちリストの表示名(相手自身の設定)にも影響しない。
//
//   bun run rename-friend.ts <相手> -n "新しい名前"            # dry-run(表示のみ)
//   bun run rename-friend.ts <相手> -n "新しい名前" --yes       # 反映
//   bun run rename-friend.ts <相手> --clear --yes               # オーバーライド解除(相手の本名表示に戻す)
//
// <相手> は表示名の部分一致(友だち)か mid。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		name: { type: "string", short: "n" },
		clear: { type: "boolean", default: false },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die('usage: bun run rename-friend.ts <相手の名前|mid> (-n "新しい名前" | --clear) [--yes]');
if (!opt.clear && !opt.name) die("`-n <新しい名前>` か `--clear` を指定してください。");
if (opt.clear && opt.name) die("`-n` と `--clear` は同時指定できません。");
const WHO = positionals[0];
const NEW = opt.clear ? "" : (opt.name ?? "");

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

type Hit = { mid: string; displayName: string; overridden: string };
async function resolve(): Promise<Hit> {
	if (/^u[0-9a-f]{32}$/.test(WHO)) {
		const r: any = await talk.getContactsV2({ mids: [WHO] });
		const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
		return { mid: WHO, displayName: c.displayName ?? "", overridden: c.displayNameOverridden ?? "" };
	}
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: Hit[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) {
				hits.push({ mid, displayName: c.displayName ?? "", overridden: c.displayNameOverridden ?? "" });
			}
		}
	}
	if (hits.length === 0) die(`「${WHO}」に一致する友だちがいません。`);
	if (hits.length > 1) die(`「${WHO}」が ${hits.length} 人にヒット。mid で指定してください:\n${hits.map((h) => `  ${h.mid}  ${h.overridden || h.displayName}`).join("\n")}`);
	return hits[0];
}

const target = await resolve();
const current = target.overridden || target.displayName;
const after = opt.clear ? `(オーバーライド解除 → 相手の本名「${target.displayName}」表示に戻す)` : `「${NEW}」`;
console.log(`アカウント: ${me.displayName}`);
console.log(`対象:   ${current}  (${target.mid})`);
console.log(`現在の override: ${target.overridden || "(なし)"}`);
console.log(`変更後:  ${after}`);
if (!opt.yes) { console.log("[dry-run] 反映するには --yes を付けてください。"); process.exit(0); }

await (await client.getUser(target.mid)).rename(opt.clear ? null : NEW);
console.log("変更しました。");
process.exit(0);
