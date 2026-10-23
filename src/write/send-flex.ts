// 個人LINE(linejs)で Flex Message を送る CLI。既定は dry-run。
// Flex は本来 LINE Messaging API(Bot)用途の形式だが、talk.sendMessage で contentType="FLEX" を
// 指定すれば個人アカウントからも送れる(受信側は LINE の標準レンダラで描画)。
// E2EE は使わない(contentMetadata ベースの構造メッセージは平文配信が前提)。
//
//   bun run src/write/send-flex.ts <相手> -f flex.json               # ファイルから Flex JSON を読む(dry-run)
//   bun run src/write/send-flex.ts <相手> -f flex.json --yes         # 送信
//   bun run src/write/send-flex.ts <相手> --preset hello --yes       # 組み込みプリセット(テスト用)
//   bun run src/write/send-flex.ts <相手> -f flex.json -a "代替文"   # alt-text(通知/非対応端末用)
//
// <相手> は表示名の部分一致 or mid(c... はグループ)。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		file: { type: "string", short: "f" },
		preset: { type: "string" },
		alt: { type: "string", short: "a" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die('usage: bun run src/write/send-flex.ts <相手の名前|mid> (-f flex.json | --preset <名>) [-a "代替文"] [--yes]');
const WHO = positionals[0];
if (!opt.file && !opt.preset) die("`-f <flex.json>` か `--preset <名>` を指定してください。");

const PRESETS: Record<string, Record<string, unknown>> = {
	hello: {
		type: "bubble",
		header: {
			type: "box", layout: "vertical", backgroundColor: "#0E4D45",
			paddingAll: "16px",
			contents: [{ type: "text", text: "Flex Message Test", color: "#FFFFFF", weight: "bold", size: "lg" }],
		},
		body: {
			type: "box", layout: "vertical", spacing: "md",
			contents: [
				{ type: "text", text: "これは Flex カードの送信テストです。", wrap: true, size: "sm" },
				{ type: "text", text: new Date().toISOString().slice(0, 10), color: "#999999", size: "xs" },
			],
		},
	},
};

const flex: Record<string, unknown> = opt.preset
	? (PRESETS[opt.preset] ?? die(`preset "${opt.preset}" は未定義 (${Object.keys(PRESETS).join(", ")})`))
	: JSON.parse(await Bun.file(opt.file!).text());
const altText = opt.alt ?? "(Flex Message)";

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
console.log(`alt-text: ${altText}`);
console.log(`---Flex JSON---`);
console.log(JSON.stringify(flex, null, 2));
console.log(`---end---`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

await talk.sendMessage({
	to,
	text: altText,          // 受信側が FLEX 非対応ならこれが見える
	contentType: "FLEX",
	contentMetadata: {
		FLEX_VER: "6",
		FLEX_JSON: JSON.stringify(flex),
		ALT_TEXT: altText,
	},
	e2ee: false,            // 構造メッセージは平文送信
} as any);
console.log(`送信しました → ${name}`);
process.exit(0);
