// 自分の友だち追加 URL (LINE ID ベース永続 or UserTicket 1回限り) を取得・表示する CLI。
//
//   bun run src/read/my-qr.ts                      # LINE ID (search ID) ベースの永久 URL (ID 登録済みなら)
//   bun run src/read/my-qr.ts --ticket             # UserTicket (1回限り、friend-ticket.ts 相当)
//   bun run src/read/my-qr.ts --qr                 # QR 画像を /tmp/my-add.png に書き出し + open
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";

const { values: opt } = parseArgs({
	options: {
		ticket: { type: "boolean", default: false },
		qr: { type: "boolean", default: false },
	},
});

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

console.log(`アカウント: ${me.displayName}  mid=${me.mid}`);
let url: string;

if (opt.ticket) {
	const r: any = await talk.generateUserTicket({ expirationTime: BigInt(Date.now() + 7 * 86400_000), maxUseCount: 0 });
	const id = r?.id ?? r?.ticketId ?? r;
	url = `https://line.me/ti/p/${typeof id === "object" ? JSON.stringify(id) : id}`;
	console.log(`(1回限り、7日)`);
} else {
	// userid (LINE ID) 検索経由の永久 URL。未設定の場合は mid ベースにフォールバック
	const uid: string = (me as any).userid ?? "";
	if (uid) url = `https://line.me/ti/p/~${uid}`;
	else url = `https://line.me/R/ti/p/@${me.mid}`;  // mid 直接 (非推奨だが)
}
console.log(`友だち追加 URL: ${url}`);

if (opt.qr) {
	const QRCode: any = (await import("qrcode")).default;
	const path = "/tmp/my-add.png";
	await QRCode.toFile(path, url, { width: 512, margin: 2 });
	console.log(`QR 画像: ${path}`);
	if (process.platform === "darwin") spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
}
process.exit(0);
