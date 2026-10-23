// 個人LINE(linejs)で位置情報メッセージを送る CLI。既定は dry-run。
// 位置は Message.location フィールドで送る(contentType は NONE のまま)。
// 実機 LINE で「現在地」として扱える最小項目は title/address/latitude/longitude。
//
//   bun run src/write/send-location.ts <相手> --lat 35.68 --lng 139.76 --title "東京駅" --addr "東京都千代田区丸の内1-9-1"
//   bun run src/write/send-location.ts <相手> --lat 35.68 --lng 139.76 --title "現在地" --yes
//
// <相手> は表示名の部分一致 or mid。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		lat: { type: "string" },
		lng: { type: "string" },
		title: { type: "string", default: "現在地" },
		addr: { type: "string", default: "" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1 || !opt.lat || !opt.lng) {
	die('usage: bun run src/write/send-location.ts <相手の名前|mid> --lat <緯度> --lng <経度> [--title "東京駅"] [--addr "..."] [--yes]');
}
const WHO = positionals[0];
const lat = Number(opt.lat);
const lng = Number(opt.lng);
if (!isFinite(lat) || !isFinite(lng)) die("lat/lng が数値ではありません。");

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})。login-linejs.ts でログインしてください。`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage }).catch((e) =>
	die(`ログイン失敗(トークン失効?)。\n${String(e).slice(0, 200)}`));
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

async function resolveTo(): Promise<{ to: string; name: string }> {
	if (/^[uc][0-9a-f]{32}$/.test(WHO)) return { to: WHO, name: WHO.slice(0, 12) };
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: { to: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) hits.push({ to: mid, name });
		}
	}
	if (hits.length === 0) die(`「${WHO}」に一致する友だちがいません(グループは mid で指定)。`);
	if (hits.length > 1) die(`「${WHO}」が ${hits.length} 人にヒット:\n${hits.map((h) => `  ${h.to}  ${h.name}`).join("\n")}`);
	return hits[0];
}

const { to, name } = await resolveTo();
console.log(`アカウント: ${me.displayName}`);
console.log(`宛先:     ${name} (${to})`);
console.log(`title:    ${opt.title}`);
console.log(`address:  ${opt.addr || "(なし)"}`);
console.log(`lat/lng:  ${lat}, ${lng}`);
console.log(`地図:     https://maps.google.com/?q=${lat},${lng}`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

await talk.sendMessage({
	to,
	text: `${opt.title}\n${opt.addr || `${lat},${lng}`}`.trim(),
	location: { title: opt.title, address: opt.addr || `${lat},${lng}`, latitude: lat, longitude: lng },
	e2ee: process.env.ENC !== "0",   // 相手が E2EE 必須なら true が必要(linejs が鍵共有を処理)
} as any);
console.log(`送信しました → ${name}`);
process.exit(0);
