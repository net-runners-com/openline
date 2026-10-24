// 友だち設定(ブロック・非表示・お気に入り・通知ミュート)の一括 CLI。
// rename-friend.ts と同系統の CONTACT_SETTING_* フラグ操作。
//
//   bun run src/write/contact-settings.ts <相手> block --yes
//   bun run src/write/contact-settings.ts <相手> unblock --yes
//   bun run src/write/contact-settings.ts <相手> hide --yes
//   bun run src/write/contact-settings.ts <相手> show --yes            # 非表示解除
//   bun run src/write/contact-settings.ts <相手> favorite --yes
//   bun run src/write/contact-settings.ts <相手> unfavorite --yes
//   bun run src/write/contact-settings.ts <相手> mute --yes
//   bun run src/write/contact-settings.ts <相手> unmute --yes
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { yes: { type: "boolean", short: "y", default: false } },
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 2) die(`usage: bun run src/write/contact-settings.ts <相手の名前|mid> <action> [--yes]
  action: block | unblock | hide | show | favorite | unfavorite | mute | unmute`);
const [WHO, action] = positionals;

const ACTIONS: Record<string, { flag: string; value: string; label: string } | { special: "block" | "unblock"; label: string }> = {
	block: { special: "block", label: "ブロック" },
	unblock: { special: "unblock", label: "ブロック解除" },
	hide: { flag: "CONTACT_SETTING_CONTACT_HIDE", value: "true", label: "非表示" },
	show: { flag: "CONTACT_SETTING_CONTACT_HIDE", value: "false", label: "非表示解除" },
	favorite: { flag: "CONTACT_SETTING_FAVORITE", value: "true", label: "お気に入り" },
	unfavorite: { flag: "CONTACT_SETTING_FAVORITE", value: "false", label: "お気に入り解除" },
	mute: { flag: "CONTACT_SETTING_NOTIFICATION_DISABLE", value: "true", label: "通知ミュート" },
	unmute: { flag: "CONTACT_SETTING_NOTIFICATION_DISABLE", value: "false", label: "通知ミュート解除" },
};
const spec = ACTIONS[action];
if (!spec) die(`unknown action: ${action}`);

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

async function resolveTo(): Promise<{ mid: string; name: string }> {
	if (/^u[0-9a-f]{32}$/.test(WHO)) return { mid: WHO, name: WHO.slice(0, 12) };
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: { mid: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) hits.push({ mid, name });
		}
	}
	if (hits.length === 0) die(`「${WHO}」に一致なし`);
	if (hits.length > 1) die(`${hits.length} 人ヒット:\n${hits.map(h => `  ${h.mid}  ${h.name}`).join("\n")}`);
	return hits[0];
}

const target = await resolveTo();
console.log(`アカウント: ${me.displayName}`);
console.log(`相手:     ${target.name} (${target.mid})`);
console.log(`操作:     ${spec.label}`);
if (!opt.yes) { console.log("[dry-run] 反映するには --yes"); process.exit(0); }

try {
	if ("special" in spec) {
		if (spec.special === "block") await talk.blockContact({ reqSeq: Number(await client.base.getReqseq("talk")), id: target.mid });
		else await talk.unblockContact({ reqSeq: Number(await client.base.getReqseq("talk")), id: target.mid });
	} else {
		await talk.updateContactSetting({ reqSeq: Number(await client.base.getReqseq("talk")), mid: target.mid, flag: spec.flag, value: spec.value });
	}
	console.log("✓ 反映");
} catch (e: any) {
	console.error(`失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 300)}`);
	process.exit(1);
}
process.exit(0);
