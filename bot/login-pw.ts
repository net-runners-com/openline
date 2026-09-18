// 個人LINE(linejs)にメールアドレス+パスワードでログインし、トークンを保存する。
//   bun run login-pw.ts                     # メイン: LINE_EMAIL / LINE_PASSWORD → storage.json
//   ACCOUNT=sub1 bun run login-pw.ts        # 別アカウント: LINE_EMAIL_SUB1 / LINE_PASSWORD_SUB1 → storage.sub1.json
//   ACCOUNT=sub1 EMU=1 bun run login-pw.ts  # 確認コードを Android エミュレーター上の LINE に adb で自動入力
// EMU=1 のとき: エミュレーターを起動(止まっていれば)し、そのアカウントの LINE を前面に出してからログインする。
// エミュレーター内に ACCOUNT と同名のプロファイルがあればそちらの LINE を使う(emu.ts 参照)。
// 一度確認コードを通すと証明書(cert:<email>)が保存され、以降はコード不要。
import { loginWithPassword } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { enterPin, openLine, startEmulator, userIdFor } from "./emu.ts";

const SUFFIX = process.env.ACCOUNT ? `_${process.env.ACCOUNT.toUpperCase()}` : "";
const EMAIL = process.env[`LINE_EMAIL${SUFFIX}`], PASSWORD = process.env[`LINE_PASSWORD${SUFFIX}`];
if (!EMAIL || !PASSWORD) throw new Error(`bot/.env に LINE_EMAIL${SUFFIX} / LINE_PASSWORD${SUFFIX} を設定してください`);
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";

const EMU = process.env.EMU === "1";
if (EMU) {
	await startEmulator();
	await openLine(await userIdFor(process.env.ACCOUNT));
}

let pinTask: Promise<void> | undefined;
const storage = new FileStorage(STORAGE);
const client = await loginWithPassword(
	{
		email: EMAIL,
		password: PASSWORD,
		onPincodeRequest(pin) {
			console.log("PINCODE(スマホに入力):", pin);
			if (EMU) pinTask = enterPin(pin).catch((e) => console.error(`自動入力に失敗: ${e.message}(手で入力してください)`));
		},
	},
	{ device: "DESKTOPWIN" as const, storage },
);
await storage.set(".auth", client.authToken);
const p = await client.getMyProfile();
console.log("LOGGED_IN_AS:", p.displayName, p.mid, `→ ${STORAGE}`);
await pinTask; // ダイアログ閉じまで待つ
process.exit(0);
