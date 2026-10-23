// 個人LINEの複数アカウント管理 CLI。サブアカウントの本体 LINE はエミュレーター内に置く(emu.ts)。
//
//   bun run src/auth/accounts.ts                  # 一覧: 保存済みトークンごとの名前・ログイン状態・認証情報・本体の場所
//   bun run src/auth/accounts.ts new <名前>       # エミュレーターにプロファイル<名前>を作って LINE を入れ、登録画面を開く
//   bun run src/auth/accounts.ts open <名前>      # そのアカウントの LINE(エミュレーター)を前面に出す
//   bun run src/auth/accounts.ts login <名前>     # メール+パスワードで CLI ログイン(確認コードは自動入力)
//   bun run src/auth/accounts.ts emu start|stop   # エミュレーターの起動/停止
//
// <名前> は ACCOUNT に渡す名前(sub1, sub2 …)。トークンは storage/<名前>.json、認証情報は .env の
// LINE_EMAIL_<名前> / LINE_PASSWORD_<名前>。メイン(storage/main.json)は本体が実機なのでここでは操作しない。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { existsSync, readdirSync } from "node:fs";
import { createProfile, isRunning, listUsers, openLine, startEmulator, stopEmulator, userIdFor } from "./emu.ts";

const [cmd = "list", arg] = Bun.argv.slice(2);
function die(msg: string): never {
	console.error(msg);
	process.exit(1);
}
const needName = () => {
	if (!arg) die(`usage: bun run src/auth/accounts.ts ${cmd} <名前>`);
	if (arg === "main") die("メインは本体が実機のため対象外です(ログインは bun run src/auth/login-linejs.ts)。");
	if (!/^[\w-]+$/.test(arg)) die("名前は英数字・-・_ のみ");
	return arg;
};

switch (cmd) {
	case "list": {
		const users = (await isRunning()) ? await listUsers() : undefined;
		const files = existsSync("./storage")
			? readdirSync("./storage").filter((f) => /^[\w-]+\.json$/.test(f)).sort()
			: [];
		for (const file of files) {
			const account = file.slice(0, -".json".length); // "main" / "sub1" / ...
			let name = "";
			try {
				const storage = new FileStorage(`./storage/${file}`);
				const client = await loginWithAuthToken((await storage.get(".auth")) as string, { device: (((await storage.get(".device")) ?? "DESKTOPWIN")) as any, storage });
				await storage.set(".auth", client.authToken);
				name = (await client.getMyProfile()).displayName;
			} catch {
				name = "(要再ログイン)";
			}
			const label = account === "main" ? "(main)" : account;
			const envKey = account === "main" ? "" : `_${account.toUpperCase()}`;
			const creds = process.env[`LINE_EMAIL${envKey}`] ? "あり" : "なし";
			const profile = users?.find((u) => u.name === account);
			const home = account === "main" ? "実機スマホ" : !users ? "エミュレーター(停止中)" : profile ? `エミュ ${profile.type} (user ${profile.id})` : "エミュ Owner";
			console.log(`${label.padEnd(8)} ${name.padEnd(14)} メール/PW:${creds}  本体:${home}`);
		}
		break;
	}
	case "new": {
		const name = needName();
		await startEmulator();
		if ((await listUsers()).some((u) => u.name === name)) die(`プロファイル ${name} は既にあります(bun run src/auth/accounts.ts open ${name})。`);
		const { id, type } = await createProfile(name);
		await openLine(id);
		const KEY = name.toUpperCase();
		console.log(`${type} プロファイル「${name}」(user ${id}) を作り、LINE を開きました。次の手順:
  1. エミュレーターのその LINE(アイコンにマーク付き)で Sign up して登録
  2. LINE の 設定 → アカウント でメールアドレスとパスワードを登録
  3. .env に LINE_EMAIL_${KEY}= と LINE_PASSWORD_${KEY}= を追加
  4. bun run src/auth/accounts.ts login ${name}`);
		break;
	}
	case "open": {
		const name = needName();
		await startEmulator();
		await openLine(await userIdFor(name));
		break;
	}
	case "login": {
		const name = needName();
		const proc = Bun.spawn([process.execPath, "run", "src/auth/login-pw.ts"], { env: { ...process.env, ACCOUNT: name, EMU: "1" }, stdio: ["inherit", "inherit", "inherit"] });
		process.exit(await proc.exited);
	}
	case "emu":
		if (arg === "start") await startEmulator();
		else if (arg === "stop") await stopEmulator();
		else die("usage: bun run src/auth/accounts.ts emu start|stop");
		break;
	default:
		die("usage: bun run src/auth/accounts.ts [list | new <名前> | open <名前> | login <名前> | emu start|stop]");
}
process.exit(0);
