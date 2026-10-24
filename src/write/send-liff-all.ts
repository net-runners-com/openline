// LIFF 経由で送信可能な全メッセージタイプを一気に送る CLI (text/image/video/audio/sticker/
// location/imagemap/template(buttons/confirm/carousel)/flex)。既定の宛先は自分の mid
// (= Keep Memo / 自分へのメッセージ) なので実験に最適。
//
//   bun run src/write/send-liff-all.ts                            # dry-run (payload を全部表示)
//   bun run src/write/send-liff-all.ts --yes                      # 自分の Keep Memo に全型送信
//   bun run src/write/send-liff-all.ts <相手名|mid> --yes          # 相手に送信(危険、普通は self テスト用)
//   bun run src/write/send-liff-all.ts --types=flex,imagemap --yes # 一部だけ
//
// 事前準備: LIFF consent 済みであること (src/write/send-liff-flex.ts で済ませてるはず)
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		types: { type: "string", default: "text,image,video,audio,sticker,location,imagemap,buttons,confirm,carousel,flex" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
const WHO = positionals[0]; // 省略で自分
const WANT = new Set(opt.types.split(",").map((s) => s.trim()));

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

async function resolveTo(): Promise<{ to: string; name: string }> {
	if (!WHO) return { to: me.mid, name: `${me.displayName} (Keep Memo)` };
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
	if (hits.length === 0) { console.error(`「${WHO}」に一致する友だちなし`); process.exit(1); }
	if (hits.length > 1) { console.error(`${hits.length} 件ヒット`); process.exit(1); }
	return hits[0];
}

// ---- preset messages ----
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

const PRESETS: Record<string, any> = {
	text: {
		type: "text",
		text: `[openline test] text message via LIFF — ${now}`,
	},
	image: {
		type: "image",
		originalContentUrl: "https://picsum.photos/seed/liff-full/1024/768",
		previewImageUrl: "https://picsum.photos/seed/liff-full/400/300",
	},
	video: {
		type: "video",
		originalContentUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
		previewImageUrl: "https://picsum.photos/seed/liff-vid/400/300",
	},
	audio: {
		type: "audio",
		originalContentUrl: "https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav",
		duration: 60000,
	},
	sticker: {
		type: "sticker",
		packageId: "11537",
		stickerId: "52002734",
	},
	location: {
		type: "location",
		title: "東京駅",
		address: "東京都千代田区丸の内1-9-1",
		latitude: 35.6812,
		longitude: 139.7671,
	},
	imagemap: {
		type: "imagemap",
		// LINE は baseUrl に /{size} (240/300/460/700/1040) を自動付加するので
		// 以下は dummyimage.com を使う (任意の WxH/色 で返す placeholder)
		baseUrl: "https://dummyimage.com/1040x1040/0e4d45/ffffff&text=openline",
		altText: "[openline test] ImageMap sample — tap regions open URLs",
		baseSize: { width: 1040, height: 1040 },
		actions: [
			{ type: "uri", label: "openline", linkUri: "https://github.com/net-runners-com/openline", area: { x: 0, y: 0, width: 520, height: 520 } },
			{ type: "uri", label: "LINE", linkUri: "https://line.me", area: { x: 520, y: 0, width: 520, height: 520 } },
			{ type: "uri", label: "Dev", linkUri: "https://developers.line.biz/en/", area: { x: 0, y: 520, width: 520, height: 520 } },
			{ type: "uri", label: "Google", linkUri: "https://www.google.com", area: { x: 520, y: 520, width: 520, height: 520 } },
		],
	},
	buttons: {
		type: "template",
		altText: "[openline test] Buttons template",
		template: {
			type: "buttons",
			thumbnailImageUrl: "https://picsum.photos/seed/buttons/1024/512",
			title: "openline Buttons template test",
			text: "LIFF の chat_message.write で Bot 専用 Buttons を個人アカから送信",
			actions: [
				{ type: "uri", label: "GitHub", uri: "https://github.com/net-runners-com/openline" },
				{ type: "uri", label: "README", uri: "https://github.com/net-runners-com/openline#readme" },
			],
		},
	},
	confirm: {
		type: "template",
		altText: "[openline test] Confirm template",
		template: {
			type: "confirm",
			text: "LIFF 経由で Confirm template 送れた？",
			actions: [
				{ type: "uri", label: "はい", uri: "https://github.com/net-runners-com/openline" },
				{ type: "uri", label: "いいえ", uri: "https://line.me" },
			],
		},
	},
	carousel: {
		type: "template",
		altText: "[openline test] Carousel template",
		template: {
			type: "carousel",
			columns: [
				{ thumbnailImageUrl: "https://picsum.photos/seed/car1/400/400", title: "Card 1", text: "First card",
					actions: [{ type: "uri", label: "Open", uri: "https://github.com/net-runners-com/openline" }] },
				{ thumbnailImageUrl: "https://picsum.photos/seed/car2/400/400", title: "Card 2", text: "Second card",
					actions: [{ type: "uri", label: "Open", uri: "https://line.me" }] },
				{ thumbnailImageUrl: "https://picsum.photos/seed/car3/400/400", title: "Card 3", text: "Third card",
					actions: [{ type: "uri", label: "Open", uri: "https://developers.line.biz/" }] },
			],
		},
	},
	flex: {
		type: "flex", altText: "[openline test] Flex",
		contents: {
			type: "bubble",
			hero: { type: "image", url: "https://picsum.photos/seed/flex-all/1024/512", size: "full", aspectRatio: "20:10", aspectMode: "cover" },
			body: { type: "box", layout: "vertical", spacing: "md", contents: [
				{ type: "text", text: "openline Flex ", weight: "bold", size: "lg" },
				{ type: "text", text: "LIFF 経由で全メッセージタイプ送信実験", size: "sm", color: "#666666", wrap: true },
				{ type: "text", text: now, size: "xs", color: "#999999" },
			]},
			footer: { type: "box", layout: "vertical", contents: [
				{ type: "button", style: "primary", color: "#0E4D45", action: { type: "uri", label: "GitHub", uri: "https://github.com/net-runners-com/openline" } },
			]},
		},
	},
};

const target = await resolveTo();
console.log(`アカウント: ${me.displayName}`);
console.log(`宛先:     ${target.name} (${target.to})`);
console.log(`タイプ:    ${[...WANT].join(", ")}`);
console.log("");

const results: { type: string; ok: boolean; detail?: string }[] = [];
for (const type of [...WANT]) {
	const msg = PRESETS[type];
	if (!msg) { console.log(`[skip] unknown type: ${type}`); continue; }
	console.log(`--- ${type} ---`);
	console.log(JSON.stringify(msg, null, 2).slice(0, 500));
	if (!opt.yes) continue;
	try {
		const r = await (client as any).liff.shareMessages(target.to, [msg], { forceIssue: false });
		const ok = r?.status === "ok";
		console.log(`  → ${ok ? "✓ sent" : "? " + JSON.stringify(r)}`);
		results.push({ type, ok, detail: JSON.stringify(r).slice(0, 100) });
	} catch (e: any) {
		const d = e?.data ? JSON.stringify(e.data).slice(0, 150) : (e?.message ?? String(e)).slice(0, 150);
		console.log(`  → ✗ ${d}`);
		results.push({ type, ok: false, detail: d });
	}
	// レート制限を避けて 2秒間隔
	await new Promise((r) => setTimeout(r, 2000));
}
if (!opt.yes) { console.log("\n[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

console.log("\n=== summary ===");
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.type.padEnd(10)} ${r.detail ?? ""}`);
process.exit(0);
