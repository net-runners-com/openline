// 電話番号から LINE ユーザー (mid + 表示名) を検索する CLI。
// 相手の電話番号を知ってると mid を特定・自動追加できる = プライバシー的に強い機能。
// 誤使用はストーカー規制法・個人情報保護法に該当する可能性あり。合意のある相手のみ使うこと。
//
//   bun run src/read/find-by-phone.ts +819012345678         # 国際形式(+81…)
//   bun run src/read/find-by-phone.ts +81 90 1234 5678      # 複数指定可(スペースで区切る)
//   bun run src/read/find-by-phone.ts +819012345678 +819087654321
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const PHONES = process.argv.slice(2);
if (PHONES.length === 0) { console.error("usage: bun run src/read/find-by-phone.ts <+国番号から始まる番号> [...]"); process.exit(1); }
for (const p of PHONES) {
	if (!/^\+\d{8,15}$/.test(p)) { console.error(`番号形式不正: ${p} (例: +819012345678)`); process.exit(1); }
}

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

console.log(`[${me.displayName}] 電話番号検索: ${PHONES.length} 件`);

try {
	const r: any = await talk.findContactsByPhone({ phones: PHONES });
	const found: Record<string, any> = r?.contacts ?? r ?? {};
	console.log(`\nヒット: ${Object.keys(found).length} 件`);
	for (const [mid, entry] of Object.entries(found)) {
		const c = (entry as any)?.contact ?? entry ?? {};
		const name = c.displayName ?? c.displayNameOverridden ?? "?";
		const status = c.statusMessage ?? "";
		console.log(`  ${mid}  ${name}${status ? "  / " + status.slice(0, 40) : ""}`);
	}
} catch (e: any) {
	console.error(`失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
