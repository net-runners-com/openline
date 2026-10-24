// 無料スタンプ(キャンペーン等) を自動 claim する CLI。
// LINE の 「無料スタンプ GET」ボタンの裏側 API を叩く。
//
//   bun run src/write/sticker-claim.ts <productId> [--yes]
//     productId は LINE Store の URL (https://store.line.me/stickershop/product/XXX/ja) から取得
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const PRODUCT_ID = process.argv[2];
const YES = process.argv.includes("--yes") || process.argv.includes("-y");
if (!PRODUCT_ID) { console.error("usage: bun run src/write/sticker-claim.ts <productId> [--yes]"); process.exit(1); }

const shopMod: any = await import("../../node_modules/@evex/linejs/base/service/shop/mod.js");

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const shop = new shopMod.ShopService(client.base);

console.log(`アカウント: ${me.displayName}`);
console.log(`productId: ${PRODUCT_ID}`);
if (!YES) { console.log("[dry-run] 無料取得するには --yes を付けてください。"); process.exit(0); }

try {
	const r: any = await shop.placePurchaseOrderForFreeProduct({ request: { productId: PRODUCT_ID } });
	console.log("取得成功:", JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 500));
} catch (e: any) {
	console.error(`失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
