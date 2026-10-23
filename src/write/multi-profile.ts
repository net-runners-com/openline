// LINE Multi Profile (サブプロフィール) 操作 CLI。LYP Premium 必須(未加入時はサーバーで NOT_PREMIUM)。
// 相手ごとに別の表示名・アイコンを見せ分けるためのサブプロフィール管理。
//
//   bun run src/write/multi-profile.ts list                            # 作成済みサブプロフィールと誰にマップされてるか
//   bun run src/write/multi-profile.ts create "<新しい表示名>"        # サブプロフィール作成 (dry-run)
//   bun run src/write/multi-profile.ts create "..." --yes             # 作成
//   bun run src/write/multi-profile.ts rename <profileId> "<新名前>" --yes
//   bun run src/write/multi-profile.ts map <profileId> <mid>  --yes   # 相手にそのプロフィールを割り当て
//   bun run src/write/multi-profile.ts unmap <profileId> <mid> --yes  # 割り当て解除
//   bun run src/write/multi-profile.ts delete <profileId> --yes       # サブプロフィール削除
//
// 相手(mid)は u... 形式のみ(表示名検索は非対応)。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const mpMod: any = await import("../../node_modules/@evex/linejs/base/service/multiprofile/mod.js");

const [cmd, ...rest] = process.argv.slice(2);
const yes = rest.includes("--yes") || rest.includes("-y");
const positionals = rest.filter((a) => a !== "--yes" && a !== "-y");
function die(m: string): never { console.error(m); process.exit(1); }

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;
const mp = new mpMod.MultiProfileService(client.base);

async function nameOf(mid: string): Promise<string> {
	try {
		const r: any = await talk.getContactsV2({ mids: [mid] });
		const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
		return c.displayNameOverridden || c.displayName || mid.slice(0, 10);
	} catch { return mid.slice(0, 10); }
}

function handleError(e: any, action: string): never {
	const code = e?.data?.code ?? "?";
	const reason = e?.data?.reason ?? e?.message ?? String(e);
	console.error(`${action} 失敗 [${code}]: ${reason}`);
	if (code === "NOT_PREMIUM") {
		console.error("→ LYP Premium 加入が必須です (月 ¥290〜)。LINE アプリの 設定 → LYP Premium から加入してください。");
	}
	process.exit(1);
}

switch (cmd) {
	case "list": {
		const mappings: any = await mp.getMappedProfileIds({ request: {} });
		const map: Record<string, string> = mappings?.mappings ?? {};
		const uniqueProfiles = Array.from(new Set(Object.values(map)));
		console.log(`[${me.displayName}]`);
		console.log(`存在するサブプロフィール: ${uniqueProfiles.length}`);
		if (uniqueProfiles.length === 0) {
			console.log("(未作成。create <displayName> で追加できます)");
		} else {
			for (const pid of uniqueProfiles) {
				const assignees = Object.entries(map).filter(([, p]) => p === pid).map(([u]) => u);
				const names = await Promise.all(assignees.map(nameOf));
				console.log(`\nprofileId: ${pid}`);
				console.log(`  割り当て中: ${assignees.length} 人`);
				for (let i = 0; i < assignees.length; i++) console.log(`    - ${names[i]} (${assignees[i]})`);
			}
		}
		break;
	}
	case "create": {
		const name = positionals[0];
		if (!name) die(`usage: bun run src/write/multi-profile.ts create "<新しい表示名>" [--yes]`);
		console.log(`アカウント: ${me.displayName}`);
		console.log(`新規サブプロフィール表示名: 「${name}」`);
		if (!yes) { console.log("[dry-run] 作成するには --yes を付けてください。"); process.exit(0); }
		try {
			const r: any = await mp.createMultiProfile({ request: { displayName: name } });
			console.log("作成しました。response:");
			console.log(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
		} catch (e: any) { handleError(e, "createMultiProfile"); }
		break;
	}
	case "rename": {
		const [pid, newName] = positionals;
		if (!pid || !newName) die(`usage: bun run src/write/multi-profile.ts rename <profileId> "<新名前>" --yes`);
		console.log(`profileId: ${pid}  → 表示名「${newName}」に変更`);
		if (!yes) { console.log("[dry-run] 反映するには --yes を付けてください。"); process.exit(0); }
		try {
			// Attribute key 1 = DISPLAY_NAME (推定、要検証)
			await mp.updateProfileAttributes({ profileAttributes: new Map([[1, { value: newName, meta: new Map() }]]) });
			console.log("更新しました。");
		} catch (e: any) { handleError(e, "updateProfileAttributes"); }
		break;
	}
	case "map": {
		const [pid, target] = positionals;
		if (!pid || !target) die(`usage: bun run src/write/multi-profile.ts map <profileId> <mid> --yes`);
		if (!/^u[0-9a-f]{32}$/.test(target)) die("mid は u... (32桁hex) 形式のみ。");
		const name = await nameOf(target);
		console.log(`profileId: ${pid}`);
		console.log(`相手:   ${name} (${target})`);
		console.log(`→ この相手には上記プロフィールが表示されるようになる`);
		if (!yes) { console.log("[dry-run] 反映するには --yes を付けてください。"); process.exit(0); }
		try {
			await mp.mapProfileToUsers({ request: { profileId: pid, targetMids: [target] } });
			console.log("割り当てました。");
		} catch (e: any) { handleError(e, "mapProfileToUsers"); }
		break;
	}
	case "unmap": {
		const [pid, target] = positionals;
		if (!pid || !target) die(`usage: bun run src/write/multi-profile.ts unmap <profileId> <mid> --yes`);
		if (!/^u[0-9a-f]{32}$/.test(target)) die("mid は u... (32桁hex) 形式のみ。");
		const name = await nameOf(target);
		console.log(`profileId: ${pid}  相手: ${name} の割り当てを解除`);
		if (!yes) { console.log("[dry-run] 反映するには --yes を付けてください。"); process.exit(0); }
		try {
			// 空の targetMids を渡すのではなく、対象 mid を "親プロフィールへ戻す" ことで解除
			// (API 的には deleteProfileMapping が無いため mapProfileToUsers を空プロファイルで上書き相当は要検証)
			await mp.mapProfileToUsers({ request: { profileId: "", targetMids: [target] } });
			console.log("解除しました(= 親プロフィールが表示される)。");
		} catch (e: any) { handleError(e, "mapProfileToUsers(unmap)"); }
		break;
	}
	case "delete": {
		const [pid] = positionals;
		if (!pid) die(`usage: bun run src/write/multi-profile.ts delete <profileId> --yes`);
		console.log(`profileId: ${pid} を削除する`);
		if (!yes) { console.log("[dry-run] 削除するには --yes を付けてください。"); process.exit(0); }
		try {
			await mp.deleteMultiProfile({ request: { profileId: pid } });
			console.log("削除しました。");
		} catch (e: any) { handleError(e, "deleteMultiProfile"); }
		break;
	}
	default:
		console.log(`openline Multi Profile CLI (LYP Premium 必須)
  bun run src/write/multi-profile.ts list
  bun run src/write/multi-profile.ts create "<表示名>" [--yes]
  bun run src/write/multi-profile.ts rename <profileId> "<新名前>" --yes
  bun run src/write/multi-profile.ts map <profileId> <mid> --yes
  bun run src/write/multi-profile.ts unmap <profileId> <mid> --yes
  bun run src/write/multi-profile.ts delete <profileId> --yes`);
		process.exit(cmd ? 1 : 0);
}
process.exit(0);
