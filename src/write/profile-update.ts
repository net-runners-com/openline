// 自分のプロフィール (displayName / statusMessage) を更新する CLI。
// 全友だち・全グループで一気に表示が変わるので注意。Multi Profile 持ってないと "全員" に影響。
// プロフィール画像は OBS アップロードが必要なので別途 (ここでは文字情報のみ)。
//
//   bun run src/write/profile-update.ts --name "新表示名"              # dry-run
//   bun run src/write/profile-update.ts --name "新表示名" --yes        # 反映
//   bun run src/write/profile-update.ts --status "ステータス文言" --yes
//   bun run src/write/profile-update.ts --show                          # 現在の値を表示
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: {
		name: { type: "string" },
		status: { type: "string" },
		show: { type: "boolean", default: false },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();

if (opt.show || (!opt.name && !opt.status)) {
	console.log(JSON.stringify({
		mid: me.mid,
		displayName: me.displayName,
		statusMessage: (me as any).statusMessage ?? "",
		picturePath: (me as any).picturePath ?? "",
	}, null, 2));
	if (!opt.name && !opt.status) process.exit(0);
}

// ProfileAttribute enum: 1=DISPLAY_NAME, 2=PICTURE, 4=STATUS_MESSAGE, 8=BACKGROUND, 16=MUSIC, ...
const changes: Array<[number, string, string]> = [];
if (opt.name) changes.push([1, "displayName", opt.name]);
if (opt.status) changes.push([4, "statusMessage", opt.status]);

console.log(`アカウント: ${me.displayName}`);
for (const [, label, val] of changes) console.log(`${label}: → "${val}"`);
if (!opt.yes) { console.log("[dry-run] 反映するには --yes を付けてください。"); process.exit(0); }

const talk = client.base.talk;
for (const [attrKey, label, val] of changes) {
	try {
		await talk.updateProfileAttribute({ reqSeq: Number(await client.base.getReqseq("talk")), attr: attrKey, value: val });
		console.log(`  ✓ ${label} 更新`);
	} catch (e: any) {
		console.error(`  ✗ ${label} 失敗: ${JSON.stringify(e?.data ?? {}).slice(0, 150)}`);
	}
}
process.exit(0);
