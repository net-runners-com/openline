// 複数アカの inbox を同時監視する CLI。各アカウントの新着を 1 ストリームにマージして出す。
//
//   bun run src/read/inbox-multi.ts                        # 全 storage/*.json を監視
//   bun run src/read/inbox-multi.ts --accounts=main,sub2   # 指定アカのみ
//   POLL=15 bun run src/read/inbox-multi.ts --json
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";

const { values: opt } = parseArgs({
	options: {
		accounts: { type: "string" },
		json: { type: "boolean", default: false },
	},
});
const POLL = Math.max(5, Number(process.env.POLL ?? 15));

let accounts: string[];
if (opt.accounts) accounts = opt.accounts.split(",").map((s) => s.trim());
else accounts = readdirSync("./storage").filter((f) => /^[\w-]+\.json$/.test(f) && f !== "routing.json" && f !== "autoreply-rules.json" && f !== "autoreply-state.json").map((f) => f.replace(/\.json$/, ""));

if (!opt.json) console.log(`[inbox-multi] accounts=${accounts.join(",")} POLL=${POLL}s`);
else console.error(`[inbox-multi] accounts=${accounts.join(",")} POLL=${POLL}s`);

type AcctCtx = { account: string; client: any; me: any; seen: Set<string>; baseline: boolean; names: Map<string, string> };

async function makeCtx(account: string): Promise<AcctCtx | null> {
	const storage = new FileStorage(`./storage/${account}.json`);
	const cached = await storage.get(".auth");
	if (typeof cached !== "string") { console.error(`[skip] ${account}: no auth`); return null; }
	const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
	try {
		const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
		await storage.set(".auth", client.authToken);
		const me = await client.getMyProfile();
		return { account, client, me, seen: new Set(), baseline: true, names: new Map() };
	} catch (e: any) {
		console.error(`[skip] ${account}: ${String(e).slice(0, 100)}`);
		return null;
	}
}

const ctxs = (await Promise.all(accounts.map(makeCtx))).filter((c): c is AcctCtx => c !== null);
if (ctxs.length === 0) { console.error("有効なアカウント無し"); process.exit(1); }

async function nameOf(ctx: AcctCtx, mid: string): Promise<string> {
	if (ctx.names.has(mid)) return ctx.names.get(mid)!;
	let n = mid.slice(0, 10);
	try {
		if (mid.startsWith("c")) {
			const r: any = await ctx.client.base.talk.getChats({ chatMids: [mid] });
			n = r?.chats?.[0]?.chatName || n;
		} else {
			const r: any = await ctx.client.base.talk.getContactsV2({ mids: [mid] });
			const c = (Object.values(r.contacts ?? {})[0] as any)?.contact ?? {};
			n = c.displayNameOverridden || c.displayName || n;
		}
	} catch {}
	ctx.names.set(mid, n);
	return n;
}

async function tick(ctx: AcctCtx) {
	const talk = ctx.client.base.talk;
	const e2ee = ctx.client.base.e2ee;
	let boxes: any[];
	try {
		const res: any = await talk.getMessageBoxes({
			messageBoxListRequest: { activeOnly: true, messageBoxCountLimit: 200, withUnreadCount: true, lastMessagesPerMessageBoxCount: 5, unreadOnly: true, lastOpRevision: 0n as any } as any,
			syncReason: "INTERNAL" as any,
		});
		boxes = res?.messageBoxes ?? [];
	} catch (e: any) { console.error(`[${ctx.account}] poll err: ${String(e).slice(0, 100)}`); return; }

	const fresh: any[] = [];
	for (const b of boxes) {
		const boxId = String(b.id ?? "");
		for (const m of b.lastMessages ?? []) {
			const mid = String(m.id ?? "");
			if (!mid || ctx.seen.has(mid)) continue;
			if (String(m.from ?? "") === ctx.me.mid) { ctx.seen.add(mid); continue; }
			if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
			fresh.push({ ts: Number(m.createdTime), from: String(m.from ?? ""), box: boxId, text: m.text ?? "", id: mid, type: m.contentType });
			ctx.seen.add(mid);
		}
	}
	if (ctx.baseline) { ctx.baseline = false; return; }
	fresh.sort((a, b) => a.ts - b.ts);
	for (const f of fresh) {
		const sender = await nameOf(ctx, f.from);
		const where = f.box.startsWith("c") ? await nameOf(ctx, f.box) : sender;
		const body = f.text || `[${f.type}]`;
		if (opt.json) {
			console.log(JSON.stringify({ ts: f.ts, account: ctx.account, as: ctx.me.displayName, from: f.from, who: sender, box: f.box, where, body }));
		} else {
			const t = new Date(f.ts).toLocaleString("ja-JP");
			console.log(`${t}  [${ctx.account}]  ${where}${sender !== where ? "/" + sender : ""}: ${body.replace(/\n/g, " ")}`);
		}
	}
}

async function tickAll() { await Promise.all(ctxs.map(tick)); }
await tickAll();
setInterval(tickAll, POLL * 1000);
