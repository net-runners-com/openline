// LINE 全設定を JSON で dump する CLI。公式アプリの UI に出てこない隠し設定も含む。
//
//   bun run src/read/settings-dump.ts                   # stdout に JSON
//   bun run src/read/settings-dump.ts > settings.json   # ファイルに保存
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const talk = client.base.talk;

const r: any = await talk.getSettings({ syncReason: "INTERNAL" as any });
const out = JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2);
console.log(out);
process.exit(0);
