// 友だちの誕生日などカレンダーイベント情報を取得する CLI。
// LINE の「友だちの誕生日通知」機能のバックエンド。相手が公開してれば取れる。
//
//   bun run src/read/contact-calendar.ts                              # 全友だち分 (300件近いと数十秒)
//   bun run src/read/contact-calendar.ts <相手名|mid>                  # 特定相手だけ
//   bun run src/read/contact-calendar.ts --upcoming=30                # 向こう30日以内の誕生日だけ
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { upcoming: { type: "string" } },
});
const WHO = positionals[0];
const UPCOMING = opt.upcoming ? Number(opt.upcoming) : null;

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

async function targetMids(): Promise<string[]> {
	if (WHO) {
		if (/^u[0-9a-f]{32}$/.test(WHO)) return [WHO];
		const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
		const mids: string[] = userFriendMids ?? [];
		const q = WHO.toLowerCase();
		const hits: string[] = [];
		for (let i = 0; i < mids.length; i += 20) {
			const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
			for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
				const c = (entry as any)?.contact ?? {};
				const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
				if (name.toLowerCase().includes(q)) hits.push(mid);
			}
		}
		if (hits.length === 0) { console.error(`「${WHO}」に一致なし`); process.exit(1); }
		return hits;
	}
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	return userFriendMids ?? [];
}

const mids = await targetMids();
console.log(`[${me.displayName}] 対象 ${mids.length} 人のカレンダーイベントを取得中…\n`);

// mid → 名前解決
const names = new Map<string, string>();
for (let i = 0; i < mids.length; i += 20) {
	const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
	for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
		const c = (entry as any)?.contact ?? {};
		names.set(mid, c.displayNameOverridden || c.displayName || mid.slice(0, 10));
	}
}

// カレンダーイベント取得 (まとめて 20 件ずつ)
// 重要: endpoint は /S4 ではなく /RE4 (APK decompile で発見)
type Birthday = { mid: string; name: string; year?: number; month: number; day: number; nextDate: Date; daysUntil: number };
const birthdays: Birthday[] = [];
for (let i = 0; i < mids.length; i += 20) {
	const slice = mids.slice(i, i + 20);
	try {
		// 手製 thrift payload: args = [[12, 1, Request]], Request = [[15, 1, [12, [targets]]], [8, 2, syncReason]]
		const targets = slice.map((mid) => [[11, 1, mid]]);
		const request = [[15, 1, [12, targets]], [8, 2, 0]];
		const args = [[12, 1, request]];
		const r: any = await (client.base as any).request.request(args, "getContactCalendarEvents", 4, true, "/RE4");
		for (const resp of r?.responses ?? []) {
			const mid = String(resp?.targetUserMid ?? "");
			const events = resp?.ContactCalendarEvents?.events ?? resp?.events ?? {};
			for (const bd of Object.values(events) as any[]) {
				if (!bd || !bd.month) continue;
				const month = Number(bd.month);
				const day = Number(bd.day ?? bd.dayOfMonth ?? 0);
				const year = bd.year ? Number(bd.year) : undefined;
				if (!month || !day) continue;
				const now = new Date();
				let next = new Date(now.getFullYear(), month - 1, day);
				if (next < now) next = new Date(now.getFullYear() + 1, month - 1, day);
				const daysUntil = Math.round((next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
				birthdays.push({ mid, name: names.get(mid) || mid.slice(0, 10), year, month, day, nextDate: next, daysUntil });
			}
		}
	} catch (e: any) {
		console.error(`[warn] batch ${i}-${i + 20} fail: ${JSON.stringify(e?.data ?? {}).slice(0, 150)}`);
	}
}

const filtered = UPCOMING != null ? birthdays.filter((b) => b.daysUntil <= UPCOMING) : birthdays;
filtered.sort((a, b) => a.daysUntil - b.daysUntil);
console.log(`誕生日データ公開: ${birthdays.length} 人${UPCOMING != null ? ` (うち ${UPCOMING}日以内: ${filtered.length})` : ""}\n`);
for (const b of filtered) {
	const yrInfo = b.year ? ` (${new Date().getFullYear() - b.year}→${new Date().getFullYear() - b.year + (b.daysUntil === 0 ? 0 : 1)}歳)` : "";
	console.log(`  ${String(b.daysUntil).padStart(3)}日後  ${b.month}/${b.day}  ${b.name}${yrInfo}`);
}
process.exit(0);
