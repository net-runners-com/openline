// 個人LINE(linejs)に QR でログインし、トークンを保存する。
//   bun run login-linejs.ts               # メイン → storage.json
//   ACCOUNT=sub bun run login-linejs.ts   # 別アカウント → storage.sub.json(QR はそのアカウントの LINE で読む)
import { loginWithQR } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const client = await loginWithQR({
  onReceiveQRUrl(url) { console.log("QR_URL:", url); },
  onPincodeRequest(pin) { console.log("PINCODE:", pin); },
}, { device: "DESKTOPWIN" as const, storage });
await storage.set(".auth", client.authToken);
const p = await client.getMyProfile();
console.log("LOGGED_IN_AS:", p.displayName, p.mid, `→ ${STORAGE}`);
process.exit(0);
