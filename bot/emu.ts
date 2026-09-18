// Android エミュレーター(adb)操作。サブアカウントの「本体」LINE をエミュレーター内に置く運用で使う。
// login-pw.ts / accounts.ts から import する。
//
// 1台のエミュレーターに置ける LINE は最大4つ: Owner(通常) + 仕事用・クローン・プライベートの各プロファイル1つずつ。
// アカウント名 = プロファイル名 にしておくと、そのアカウントの LINE を自動で選ぶ(該当なしは Owner)。
import { $ } from "bun";
import { homedir } from "node:os";

export const SDK = process.env.ANDROID_SDK ?? `${homedir()}/Library/Android/sdk`;
const ADB = process.env.ADB ?? `${SDK}/platform-tools/adb`;
export const AVD = process.env.EMU_AVD ?? "Pixel_8";
export const LINE_PKG = "jp.naver.line.android";
const PROFILE_TYPES = ["profile.MANAGED", "profile.CLONE", "profile.PRIVATE"];
// プロファイルで LINE の Google ログインに要るもの
const PROFILE_PKGS = [LINE_PKG, "com.google.android.gms", "com.google.android.gsf", "com.android.vending"];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const adb = (...args: string[]) => $`${ADB} ${args}`.quiet().nothrow().text();
const center = (bounds: string) => {
	const [x1, y1, x2, y2] = bounds.match(/\d+/g)!.map(Number);
	return [String((x1 + x2) >> 1), String((y1 + y2) >> 1)];
};
const uiDump = async () => {
	await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
	return adb("shell", "cat", "/sdcard/ui.xml");
};

export const isRunning = async () => (await adb("get-state")).trim() === "device";

export async function startEmulator() {
	if (!(await isRunning())) {
		console.log(`エミュレーター(${AVD})を起動中…`);
		// quickboot: 前回終了時のスナップショットから起動し、終了時に保存する(既定動作)。
		// -no-snapshot-save を付けると次回起動で古いスナップショットに戻り、本体 LINE のデータが消えるので付けない
		Bun.spawn([`${SDK}/emulator/emulator`, "-avd", AVD, "-no-boot-anim"], { stdout: "ignore", stderr: "ignore" }).unref();
	}
	for (let i = 0; (await adb("shell", "getprop", "sys.boot_completed")).trim() !== "1"; i++) {
		if (i >= 90) throw new Error("エミュレーターが起動しません");
		await sleep(2000);
	}
	await adb("shell", "input", "keyevent", "224"); // 画面オン
	await adb("shell", "wm", "dismiss-keyguard");
}

// 終了前に今の状態を quickboot スナップショットへ保存してから止める(本体 LINE のデータを失わないため)
export async function stopEmulator() {
	if (!(await isRunning())) return;
	await adb("emu", "avd", "snapshot", "save", "default_boot");
	await adb("emu", "kill");
}

export type EmuUser = { id: string; name: string; type: string; running: boolean };
export async function listUsers(): Promise<EmuUser[]> {
	const out = await adb("shell", "cmd", "user", "list", "-v");
	return [...out.matchAll(/id=(\d+), name=([^,]*), type=([^,]+),[^\n]*/g)].map((m) => ({
		id: m[1], name: m[2], type: m[3], running: m[0].includes("(running)"),
	}));
}

// アカウント名と同名のプロファイルの user id。無ければ Owner(0)
export const userIdFor = async (account?: string) => (await listUsers()).find((u) => u.name === account)?.id ?? "0";

export async function openLine(user: string) {
	for (let i = 0; !(await adb("shell", "am", "get-started-user-state", user)).includes("RUNNING_UNLOCKED"); i++) {
		if (i === 0) await adb("shell", "am", "start-user", user);
		if (i >= 20) throw new Error(`user ${user} が起動しません`);
		await sleep(1000);
	}
	await adb("shell", "am", "start", "--user", user, "-n", `${LINE_PKG}/.activity.SplashActivity`);
}

// 空いているプロファイル種別で <name> を作り、LINE と Google 系アプリを入れる
export async function createProfile(name: string) {
	const used = (await listUsers()).map((u) => u.type);
	for (const type of PROFILE_TYPES.filter((t) => !used.includes(t))) {
		const out = await adb("shell", "pm", "create-user", "--profileOf", "0", "--user-type", `android.os.usertype.${type}`, name);
		const id = out.match(/created user id (\d+)/)?.[1];
		if (!id) continue;
		for (const pkg of PROFILE_PKGS) await adb("shell", "pm", "install-existing", "--user", id, pkg);
		await adb("shell", "am", "start-user", id);
		return { id, type };
	}
	throw new Error("このエミュレーターにはもうプロファイルを作れません(仕事用・クローン・プライベートを使用済み)。別の AVD を EMU_AVD で指定してください");
}

// 確認コード画面(DesktopLoginActivity)を待ってコード入力→Verify→完了ダイアログを閉じる
export async function enterPin(pin: string) {
	for (let i = 0; !(await adb("shell", "dumpsys window | grep mCurrentFocus")).includes("DesktopLoginActivity"); i++) {
		if (i >= 30) throw new Error("エミュレーターに確認コード画面が出ません");
		await sleep(1000);
	}
	const field = (await uiDump()).match(/class="android\.widget\.EditText"[^>]*bounds="([^"]+)"/)?.[1];
	await adb("shell", "input", "tap", ...(field ? center(field) : ["540", "675"]));
	await adb("shell", "input", "text", pin);
	await sleep(500);
	const verify = (await uiDump()).match(/text="(?:Verify|認証|確認)"[^>]*bounds="([^"]+)"/)?.[1];
	await adb("shell", "input", "tap", ...(verify ? center(verify) : ["539", "2155"]));
	await sleep(2000); // 「Verification code sent.」ダイアログを閉じる
	const ok = (await uiDump()).match(/text="(?:OK|確認)"[^>]*bounds="([^"]+)"/)?.[1];
	await adb("shell", ...(ok ? ["input", "tap", ...center(ok)] : ["input", "keyevent", "4"]));
	console.log("確認コードをエミュレーターに入力しました");
}
