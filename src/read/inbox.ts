// 個人LINE(linejs)の未読/新着メッセージを見る CLI。読み取りのみ・既読はつけない。
//
//   bun run inbox.ts                 # メイン(storage.json)を監視。新着を表示し続ける
//   ACCOUNT=sub2 bun run inbox.ts    # 別アカウント(storage.sub2.json)を監視
//   POLL=15 bun run inbox.ts         # ポーリング間隔(秒) 既定 30
//   bun run inbox.ts --json          # 1件1行の JSON。Monitor + PushNotification 連携用
//
// 方式: `getMessageBoxes(unreadOnly=true)` を定期的に叩き、前回スナップショットとの diff を出す。
// client.listen() は実機デバイスと長polling の revision を奪い合うため、同じ auth の daemon では
// push が流れないケースがあった。この方式ならサーバー状態を直接見るので実機と共存できる。
// 既読(sendChatChecked)は呼ばない。Ctrl-C で終了。
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const JSON_MODE = process.argv.includes("--json");
const POLL_SEC = Math.max(5, Number(process.env.POLL ?? 30));
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const LOGIN = `${process.env.ACCOUNT ? `ACCOUNT=${process.env.ACCOUNT} ` : ""}bun run login-linejs.ts`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})。\`${LOGIN}\` でログインしてください。`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage }).catch((e) => {
	console.error(`ログイン失敗(トークン失効?)。\`${LOGIN}\` で再ログイン。\n${String(e).slice(0, 200)}`); process.exit(1);
});
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;
const e2ee = client.base.e2ee;

const banner = `[${me.displayName}] 新着を監視中 (${POLL_SEC}秒間隔, 既読はつけません, Ctrl-C で終了)`;
if (JSON_MODE) console.error(banner); else console.log(`${banner}\n`);

// 名前キャッシュ(mid/chatId -> 表示名)
const names = new Map<string, string>();
async function nameOf(id: string): Promise<string> {
	if (names.has(id)) return names.get(id)!;
	let n = id.slice(0, 10);
	try {
		if (id.startsWith("c")) {
			const r: any = await talk.getChats({ request: { chatMids: [id], withMembers: false, withInvitees: false }, syncReason: "INTERNAL" as any });
			n = r?.chats?.[0]?.chatName || n;
		} else {
			const r: any = await talk.getContactsV2({ mids: [id] });
			const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
			n = c.displayNameOverridden || c.displayName || n;
		}
	} catch {}
	names.set(id, n);
	return n;
}

// 直近に出力したメッセージ ID(重複出力防止)。起動時は空 → 初回ポーリングはベースラインとして emit せず記録のみ。
const seen = new Set<string>();
let baseline = true;

async function tick() {
	let boxes: any[] = [];
	try {
		const res: any = await talk.getMessageBoxes({
			messageBoxListRequest: {
				activeOnly: true, messageBoxCountLimit: 200,
				withUnreadCount: true, lastMessagesPerMessageBoxCount: 5, unreadOnly: true, lastOpRevision: 0n as any,
			} as any,
			syncReason: "INTERNAL" as any,
		});
		boxes = res?.messageBoxes ?? [];
	} catch (e) {
		console.error(`[${new Date().toISOString()}] poll error: ${String(e).slice(0, 200)}`);
		return;
	}
	// 新着を時系列順に収集
	const fresh: { ts: number; id: string; from: string; box: string; body: string; isGroup: boolean }[] = [];
	for (const b of boxes) {
		const boxId = String(b.id ?? "");
		for (const m of b.lastMessages ?? []) {
			const mid = String(m.id ?? "");
			if (!mid || seen.has(mid)) continue;
			if (String(m.from ?? "") === me.mid) { seen.add(mid); continue; } // 自分の送信は無視
			if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
			fresh.push({
				ts: Number(m.createdTime ?? Date.now()),
				id: mid,
				from: String(m.from ?? ""),
				box: boxId,
				body: m.text ? m.text.replace(/\n/g, " ") : `[${m.contentType ?? "?"}]`,
				isGroup: boxId.startsWith("c"),
			});
			seen.add(mid);
		}
	}
	fresh.sort((a, b) => a.ts - b.ts);
	// 初回はベースライン化のみ(過去の未読が爆発するのを防ぐ)
	if (baseline) { baseline = false; return; }
	for (const f of fresh) {
		const sender = await nameOf(f.from);
		const where = f.isGroup ? await nameOf(f.box) : sender;
		if (JSON_MODE) {
			console.log(JSON.stringify({ ts: f.ts, id: f.id, from: f.from, who: sender, box: f.box, where, body: f.body }));
		} else {
			const t = new Date(f.ts).toLocaleString("ja-JP");
			const label = f.isGroup ? `${where} / ${sender}` : sender;
			console.log(`${t}  ${label}: ${f.body}`);
		}
	}
}

// 最初の tick で baseline を取り、以降は POLL_SEC 間隔
await tick();
setInterval(tick, POLL_SEC * 1000);
