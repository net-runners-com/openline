// 個人LINE(linejs)で LIFF 権限経由で Flex Message を送る CLI。
// talk.sendMessage(contentType=FLEX) は個人アカから INCOMPATIBLE_APP_VERSION で弾かれるが、
// LIFF の chat_message.write 権限を取れば任意トークに Flex を注入できる。
// 事前準備: 初回のみブラウザで consent 必要 (docs/notes.md 参照)。
//
//   bun run src/write/send-liff-flex.ts <相手> [--preset rich|schedule|hello] [--yes]
//
// デフォルトは --preset rich。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		preset: { type: "string", default: "rich" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die('usage: bun run src/write/send-liff-flex.ts <相手の名前|mid> [--preset rich|schedule|hello] [--yes]');
const WHO = positionals[0];

// ---- presets ----
const now = new Date();
const nowStr = now.toISOString().slice(0, 16).replace("T", " ");

function helloPreset() {
	return {
		type: "flex", altText: "Flex via LIFF テスト",
		contents: {
			type: "bubble",
			header: { type: "box", layout: "vertical", backgroundColor: "#0E4D45", paddingAll: "16px",
				contents: [{ type: "text", text: "Flex via LIFF", color: "#FFFFFF", weight: "bold", size: "lg" }] },
			body: { type: "box", layout: "vertical", spacing: "md",
				contents: [
					{ type: "text", text: "個人アカから LIFF 経由で Flex を送るテストです。", wrap: true, size: "sm" },
					{ type: "text", text: nowStr, color: "#999999", size: "xs" },
				] },
		},
	};
}

function richPreset() {
	const bubble = (o: { hero: string; title: string; subtitle: string; emoji: string; rows: [string, string][]; cta: { label: string; url: string }[] }): any => ({
		type: "bubble", size: "giga",
		hero: { type: "image", url: o.hero, size: "full", aspectRatio: "20:9", aspectMode: "cover" },
		body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "20px", contents: [
			{ type: "box", layout: "baseline", spacing: "sm", contents: [
				{ type: "text", text: o.emoji, size: "xxl", flex: 0 },
				{ type: "text", text: o.title, size: "xl", weight: "bold", color: "#111111", wrap: true },
			] },
			{ type: "text", text: o.subtitle, size: "sm", color: "#666666", wrap: true },
			{ type: "box", layout: "baseline", margin: "md", contents: [
				...Array(5).fill(0).map(() => ({ type: "icon", url: "https://scdn.line-apps.com/n/channel_devcenter/img/fx/review_gold_star_28.png", size: "sm" })),
				{ type: "text", text: "5.0", size: "sm", color: "#999999", margin: "md", flex: 0 },
			] },
			{ type: "separator", margin: "lg" },
			{ type: "box", layout: "vertical", margin: "lg", spacing: "sm", contents: o.rows.map(([k, v]) => ({
				type: "box", layout: "baseline", spacing: "sm", contents: [
					{ type: "text", text: k, color: "#999999", size: "sm", flex: 2 },
					{ type: "text", text: v, color: "#333333", size: "sm", flex: 5, wrap: true },
				],
			})) },
		] },
		footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
			contents: o.cta.map((c, i) => ({ type: "button", style: i === 0 ? "primary" : "secondary", height: "sm",
				color: i === 0 ? "#0E4D45" : undefined,
				action: { type: "uri", label: c.label, uri: c.url } })) },
		styles: { footer: { separator: true } },
	});
	return {
		type: "flex", altText: "openline — Rich Flex ショーケース",
		contents: { type: "carousel", contents: [
			bubble({ hero: "https://picsum.photos/seed/openline/800/360", emoji: "🚀", title: "openline", subtitle: "Personal LINE automation CLI",
				rows: [["Repo", "net-runners-com/openline"], ["Lang", "TypeScript + Bun"], ["CLIs", "15+ scripts"], ["License", "MIT"]],
				cta: [{ label: "GitHub", url: "https://github.com/net-runners-com/openline" }] }),
			bubble({ hero: "https://picsum.photos/seed/flex/800/360", emoji: "✨", title: "Flex Message", subtitle: "普通は Bot 専用。LIFF の chat_message.write 経由で個人アカからも送れる",
				rows: [["Spec", "Flex Message v3"], ["Container", "Bubble / Carousel"], ["Max bubbles", "12 /carousel"], ["Payload", "max 50KB"]],
				cta: [{ label: "LINE Flex Docs", url: "https://developers.line.biz/en/docs/messaging-api/using-flex-messages/" }] }),
		] },
	};
}

function schedulePreset() {
	// 候補枠(デモ用): 明日 10/14/16時 の1時間枠
	const base = new Date(now); base.setDate(base.getDate() + 1); base.setMinutes(0, 0, 0);
	const dayJa = ["日", "月", "火", "水", "木", "金", "土"][base.getDay()];
	const slots = [10, 14, 16].map((hour) => {
		const d = new Date(base); d.setHours(hour, 0, 0, 0);
		const end = hour + 1;
		return {
			label: `${d.getMonth() + 1}/${d.getDate()}(${dayJa}) ${hour}:00-${end}:00`,
			reply: `この日時でお願いします: ${d.getMonth() + 1}/${d.getDate()}(${dayJa}) ${hour}:00-${end}:00`,
		};
	});
	return {
		type: "flex", altText: "日程候補をお送りします。ご都合良い枠をタップしてください。",
		contents: {
			type: "bubble", size: "mega",
			header: { type: "box", layout: "vertical", backgroundColor: "#0E4D45", paddingAll: "16px",
				contents: [
					{ type: "text", text: "📅 日程調整", color: "#FFFFFF", weight: "bold", size: "lg" },
					{ type: "text", text: "ご都合良い枠を1つタップしてください", color: "#B6D9D0", size: "xs", margin: "sm" },
				] },
			body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "20px", contents: [
				{ type: "text", text: `候補 ${slots.length} 枠（${nowStr} 時点）`, size: "sm", color: "#666666" },
				{ type: "separator", margin: "md" },
				{ type: "box", layout: "vertical", margin: "md", spacing: "sm", contents: slots.map((s) => ({
					type: "box", layout: "baseline", spacing: "sm", contents: [
						{ type: "text", text: "・", color: "#0E4D45", flex: 0 },
						{ type: "text", text: s.label, color: "#333333", size: "sm" },
					],
				})) },
			] },
			footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
				contents: slots.map((s) => ({
					type: "button", style: "primary", height: "sm", color: "#0E4D45",
					action: { type: "message", label: s.label, text: s.reply },
				})) },
			styles: { footer: { separator: true } },
		},
	};
}

const PRESETS: Record<string, () => any> = { hello: helloPreset, rich: richPreset, schedule: schedulePreset };
const flex = (PRESETS[opt.preset] ?? die(`unknown preset: ${opt.preset} (available: ${Object.keys(PRESETS).join(", ")})`))();

// ---- send ----
const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage }).catch((e) =>
	die(`ログイン失敗: ${String(e).slice(0, 200)}`));
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
	if (hits.length === 0) die(`「${WHO}」に一致する友だちがいません`);
	if (hits.length > 1) die(`${hits.length} 人ヒット:\n${hits.map((h) => `  ${h.to}  ${h.name}`).join("\n")}`);
	return hits[0];
}

const { to, name } = await resolveTo();
console.log(`アカウント: ${me.displayName}`);
console.log(`宛先: ${name} (${to})`);
console.log(`preset: ${opt.preset}`);
console.log(`alt-text: ${flex.altText}`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

try {
	const res = await (client as any).liff.shareMessages(to, [flex], { forceIssue: true });
	console.log("response:", JSON.stringify(res));
	console.log(`送信しました → ${name}`);
} catch (e: any) {
	console.error("LIFF share 失敗:", e?.message ?? String(e));
	if (e?.data) console.error("data:", JSON.stringify(e.data, null, 2));
	process.exit(1);
}
process.exit(0);
