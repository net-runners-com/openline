// 自分の GPS を送って「Nearby」公開中の近くの LINE ユーザー一覧を取得する CLI。
// 昔のふるふる/Nearby friends 機能のバックエンド。相手が明示的に Nearby オンにしてないと出てこない。
//
//   bun run src/read/nearby.ts --lat 35.68 --lng 139.76         # 緯度経度指定
//   bun run src/read/nearby.ts                                   # GPS 自動取得 (CoreLocationCLI)
//   bun run src/read/nearby.ts --radius 500                      # 精度半径 500m と宣言
//
// 注意: 自分の GPS が LINE サーバーに送られる。相手には自分も Nearby 公開中として表示される可能性あり。
// Nearby オプトイン必要かも(LINE 設定 → プライバシー → 近くにいる人)。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";

const { values: opt } = parseArgs({
	options: {
		lat: { type: "string" },
		lng: { type: "string" },
		radius: { type: "string", default: "50" },
	},
});

function die(m: string): never { console.error(m); process.exit(1); }

async function getLocation(): Promise<{ lat: number; lng: number }> {
	if (opt.lat && opt.lng) return { lat: Number(opt.lat), lng: Number(opt.lng) };
	// macOS: CoreLocationCLI
	try {
		const out = execSync("CoreLocationCLI -once -format '%latitude %longitude'", { timeout: 15000 }).toString().trim();
		const [lat, lng] = out.split(/\s+/).map(Number);
		if (isFinite(lat) && isFinite(lng)) return { lat, lng };
	} catch {}
	die("GPS 取得失敗。--lat / --lng で手動指定してください。");
}

const { lat, lng } = await getLocation();
const radiusMeters = Number(opt.radius);

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

console.log(`[${me.displayName}] Nearby 検索 (lat=${lat}, lng=${lng}, radius=${radiusMeters}m)`);

try {
	const r: any = await talk.updateAndGetNearby({
		latitude: lat,
		longitude: lng,
		accuracy: { radiusMeters, radiusConfidence: 0.5, altitudeAccuracy: 0, velocityAccuracy: 0 },
	});
	const entries: any[] = r?.nearbyUsers ?? r?.entries ?? r?.success ?? [];
	console.log(`\n見つかった Nearby ユーザー: ${entries.length} 人`);
	if (entries.length === 0) {
		console.log(`(周辺に Nearby 公開中のユーザーなし。または自分が Nearby オプトインしてない可能性)`);
	}
	for (const e of entries.slice(0, 50)) {
		const name = e?.displayName ?? e?.contact?.displayName ?? "?";
		const mid = e?.mid ?? e?.userMid ?? e?.contact?.mid ?? "?";
		const dist = e?.distance ?? e?.meters ?? "?";
		const updated = e?.updatedTime ? new Date(Number(e.updatedTime)).toLocaleString("ja-JP") : "?";
		console.log(`  ${name.padEnd(18)}  ${dist}m  更新:${updated}  mid=${String(mid).slice(0, 12)}`);
	}
} catch (e: any) {
	console.error(`取得失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
