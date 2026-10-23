// 個人LINE(linejs)に QR でログインし、トークンを保存する。
//   bun run src/auth/login-linejs.ts               # メイン → storage.json。QR を PNG で出して macOS の Preview で開く
//   ACCOUNT=sub bun run src/auth/login-linejs.ts   # 別アカウント → storage/sub.json(そのアカウントの LINE で読む)
//   NO_OPEN=1 bun run src/auth/login-linejs.ts     # PNG は書くが自動 open しない
//   NO_IMAGE=1 bun run src/auth/login-linejs.ts    # PNG を作らず URL だけ出す(スマホで URL を手入力する場合)
import { loginWithQR } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import QRCode from "qrcode";
import { spawn } from "node:child_process";

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const QR_PATH = `./.qr-${process.env.ACCOUNT ?? "main"}.png`;
const storage = new FileStorage(STORAGE);
const DEVICE = (process.env.DEVICE ?? (await storage.get(".device")) ?? "DESKTOPWIN") as any;

async function renderQr(url: string) {
	console.log("QR_URL:", url);
	if (process.env.NO_IMAGE) return;
	try {
		await QRCode.toFile(QR_PATH, url, { width: 512, margin: 2 });
		console.log(`QR_IMAGE: ${QR_PATH}`);
		if (!process.env.NO_OPEN && process.platform === "darwin") {
			spawn("open", [QR_PATH], { detached: true, stdio: "ignore" }).unref();
		}
	} catch (e) {
		console.error(`QR PNG 作成失敗: ${String(e).slice(0, 200)}`);
	}
}

const client = await loginWithQR({
	onReceiveQRUrl(url) { void renderQr(url); },
	onPincodeRequest(pin) { console.log("PINCODE:", pin); },
}, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
await storage.set(".device", DEVICE);
const p = await client.getMyProfile();
console.log("LOGGED_IN_AS:", p.displayName, p.mid, `→ ${STORAGE}`);
// 使い終わった QR 画像は消しておく(認証URLなので念のため)
try { await Bun.write(QR_PATH, new Uint8Array(0)); await Bun.file(QR_PATH).text(); } catch {}
try { const { unlink } = await import("node:fs/promises"); await unlink(QR_PATH); } catch {}
process.exit(0);
