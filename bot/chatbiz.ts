// chat.line.biz 内部 API クライアント（実行時にブラウザ不要）。
// 認証は Playwright storage-state 形式の Cookie ファイル（.chatbiz-auth.json、gitignore 済み）。
//
//   bun run chatbiz.ts auth [--login]          Cookie を取り直す（--login で headed ブラウザを開いて手動ログイン）
//   bun run chatbiz.ts me                      セッション確認
//   bun run chatbiz.ts chats                   会話一覧（chatId / 名前 / 最終メッセージ）
//   bun run chatbiz.ts send <chatId> <text>
//   bun run chatbiz.ts card <chatId> <cardTypeMessageId>
//   bun run chatbiz.ts sticker <chatId> <packageId> <stickerId>
//   bun run chatbiz.ts file <chatId> <path>
//   bun run chatbiz.ts schedule <chatId> <ISO 時刻> <text>   予約送信（テキストのみ）
//   bun run chatbiz.ts scheduled <chatId>
//   bun run chatbiz.ts broadcast (--text <t> | --card <id>) [--only <chatId,..>] [--yes]
//                                              会話一覧の全員に 1 通ずつ。--yes 無しはドライラン
//
// 制約（bot/chatbiz.md）: 送れる相手は OA に話しかけてきた人のみ。20 通 / 60 秒 / チャット。
// Flex は不可（manager で作ったカードの ID 参照のみ）。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BOT = process.env.CHATBIZ_BOT ?? "Ub4aa0ca3051d9abc64e21e982ec40537"; // ひろと@AI屋さん / @492qwqka
const ORIGIN = "https://chat.line.biz";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(HERE, ".chatbiz-auth.json");
const WEBTRACE = join(homedir(), ".claude/skills/webtrace/scripts/trace.mjs");
const PROFILE = join(homedir(), ".claude/skills/webtrace/profiles/linebiz");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const GAP_MS = 3100; // 20 通/分を超えない間隔

// ---------- auth ----------

function cookieHeader(): string {
	if (process.env.CHATBIZ_COOKIE) return process.env.CHATBIZ_COOKIE;
	if (!existsSync(AUTH_FILE)) throw new Error(`no ${basename(AUTH_FILE)} — run: bun run chatbiz.ts auth`);
	const state = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as { cookies: Array<{ name: string; value: string; domain: string }> };
	const pairs = state.cookies
		.filter((c) => ["chat.line.biz", ".chat.line.biz", ".line.biz"].includes(c.domain))
		.map((c) => `${c.name}=${c.value}`);
	if (!pairs.length) throw new Error("no line.biz cookies in auth file — run: bun run chatbiz.ts auth --login");
	return pairs.join("; ");
}

function runAuth(login: boolean) {
	// headless の書き出しは、前回の cloakbrowser がプロファイルを掴んでいても動くようコピーを使う
	let profile = PROFILE;
	if (!login) {
		profile = `${PROFILE}-copy`;
		spawnSync("rm", ["-rf", profile]);
		spawnSync("cp", ["-R", PROFILE, profile]);
		for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) spawnSync("rm", ["-f", join(profile, f)]);
	}
	const args = [WEBTRACE, `${ORIGIN}/`, "--profile", profile, "--save-storage", AUTH_FILE, "--out", join(HERE, "../.webtrace-auth")];
	args.push(...(login ? ["--headed", "--keep-open"] : ["--until", "networkidle", "--wait", "3000"]));
	if (login) console.log("ブラウザでログインしたら、このターミナルで Ctrl-C を押すと Cookie が保存されます。\n（'profile is already in use' で落ちる時は前回の cloakbrowser ウィンドウを閉じる）");
	const r = spawnSync("node", args, { stdio: "inherit" });
	if (r.status !== 0 && !login) throw new Error(`webtrace exited ${r.status}`);
}

// ---------- http ----------

let csrfCache: string | undefined;

async function api(path: string, init: RequestInit & { chatId?: string } = {}) {
	const headers: Record<string, string> = {
		Cookie: cookieHeader(),
		"User-Agent": UA,
		Accept: "application/json",
		Origin: ORIGIN,
		Referer: init.chatId ? `${ORIGIN}/${BOT}/chat/${init.chatId}` : `${ORIGIN}/${BOT}`,
		...(init.headers as Record<string, string> | undefined),
	};
	if (init.method && init.method !== "GET") {
		csrfCache ??= await csrf();
		headers["X-XSRF-TOKEN"] = csrfCache;
	}
	const res = await fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
	if (res.status >= 300 && res.status < 400) throw new Error(`redirected (${res.status}) — session expired? run: bun run chatbiz.ts auth --login`);
	return res;
}

async function csrf(): Promise<string> {
	const res = await api("/api/v1/csrfToken");
	if (!res.ok) throw new Error(`csrfToken -> ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error("csrfToken: no token");
	return body.token;
}

async function json<T>(res: Response): Promise<T> {
	const text = await res.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		return text as unknown as T;
	}
}

const sendId = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- ops ----------

type Chat = { chatId: string; profile?: { name?: string }; nickname?: string; lastTalkedAt?: number; latestEvent?: { messages?: Array<{ text?: string; type?: string }> } };

// 会話一覧を全ページ取得。API は1ページ25件で、続きは next カーソルで辿る。
// (pinned が各ページに混ざり得るので chatId で重複排除)
async function listChats(): Promise<Chat[]> {
	// prioritizePinnedChat は全ページで固定(切り替えると next カーソルが不整合になる)。
	// dedupe は保険。next が無くなるまで辿る。(実測: cursor フィールドは "next")
	const byId = new Map<string, Chat>();
	let next: string | undefined;
	for (let page = 0; page < 500; page++) {
		const q = new URLSearchParams({ folderType: "ALL", tagIds: "", autoTagIds: "", limit: "25", prioritizePinnedChat: "false" });
		if (next) q.set("next", next);
		const res = await api(`/api/v2/bots/${BOT}/chats?${q.toString()}`);
		if (!res.ok) throw new Error(`chats -> ${res.status} ${await res.text()}`);
		const body = await json<{ list?: Chat[]; next?: string }>(res);
		const list = body.list ?? [];
		for (const c of list) byId.set(c.chatId, c);
		next = body.next;
		if (!next || list.length === 0) break;
	}
	return [...byId.values()];
}

const chatName = (c: Chat) => c.nickname || c.profile?.name || "";

async function sendMessage(chatId: string, message: Record<string, unknown>): Promise<number> {
	const res = await api(`/api/v1/bots/${BOT}/chats/${chatId}/messages/send`, {
		method: "POST",
		chatId,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...message, sendId: sendId() }),
	});
	if (res.status === 429) {
		console.warn(`429 on ${chatId} — 60s 待って再送`);
		await sleep(60_000);
		return sendMessage(chatId, message);
	}
	if (!res.ok) console.error(`send ${chatId} -> ${res.status} ${await res.text()}`);
	return res.status;
}

const sendText = (chatId: string, text: string) => sendMessage(chatId, { type: "text", text });
const sendCard = (chatId: string, id: number) => sendMessage(chatId, { id: "", type: "cardType", cardTypeMessageId: id });
const sendSticker = (chatId: string, packageId: string, stickerId: string) => sendMessage(chatId, { type: "sticker", packageId, stickerId });

async function sendFile(chatId: string, path: string): Promise<number> {
	const fd = new FormData();
	fd.append("file", Bun.file(path), basename(path));
	fd.append("sendId", sendId());
	const res = await api(`/api/v1/bots/${BOT}/chats/${chatId}/messages/sendFile`, { method: "POST", chatId, body: fd });
	if (!res.ok) console.error(`sendFile -> ${res.status} ${await res.text()}`);
	return res.status;
}

async function schedule(chatId: string, at: Date, text: string) {
	const res = await api(`/api/v1/bots/${BOT}/chats/${chatId}/messages/scheduled`, {
		method: "POST",
		chatId,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message: { id: "", type: "textV2", text }, scheduledAt: at.getTime() }),
	});
	console.log(res.status, await res.text());
}

async function listScheduled(chatId: string) {
	const res = await api(`/api/v1/bots/${BOT}/chats/${chatId}/messages/scheduled`, { chatId });
	const body = await json<{ list?: Array<{ scheduledMessageId: string; scheduledAt: number; status: string; message?: { text?: string } }> }>(res);
	for (const s of body.list ?? []) console.log(`${s.scheduledMessageId}\t${new Date(s.scheduledAt).toLocaleString("ja-JP")}\t${s.status}\t${s.message?.text ?? ""}`);
	if (!body.list?.length) console.log("(none)");
}

// ---------- cli ----------

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
	case "auth": {
		runAuth(rest.includes("--login"));
		const res = await api("/api/v1/me");
		console.log(res.ok ? `OK: logged in (${JSON.stringify(await json(res)).slice(0, 120)})` : `NG: /api/v1/me -> ${res.status}. run: bun run chatbiz.ts auth --login`);
		break;
	}
	case "me": {
		const res = await api("/api/v1/me");
		console.log(res.status, JSON.stringify(await json(res)).slice(0, 300));
		break;
	}
	case "chats": {
		for (const c of await listChats()) {
			const last = c.latestEvent?.messages?.[0];
			console.log(`${c.chatId}\t${chatName(c)}\t${last?.text ?? last?.type ?? ""}`);
		}
		break;
	}
	case "send": {
		const [chatId, ...t] = rest;
		if (!chatId || !t.length) throw new Error("usage: send <chatId> <text>");
		console.log(await sendText(chatId, t.join(" ")));
		break;
	}
	case "card": {
		const [chatId, id] = rest;
		if (!chatId || !id) throw new Error("usage: card <chatId> <cardTypeMessageId>");
		console.log(await sendCard(chatId, Number(id)));
		break;
	}
	case "sticker": {
		const [chatId, p, s] = rest;
		if (!chatId || !p || !s) throw new Error("usage: sticker <chatId> <packageId> <stickerId>");
		console.log(await sendSticker(chatId, p, s));
		break;
	}
	case "file": {
		const [chatId, path] = rest;
		if (!chatId || !path) throw new Error("usage: file <chatId> <path>");
		console.log(await sendFile(chatId, path));
		break;
	}
	case "schedule": {
		const [chatId, when, ...t] = rest;
		if (!chatId || !when || !t.length) throw new Error("usage: schedule <chatId> <ISO time> <text>");
		const at = new Date(when);
		if (Number.isNaN(at.getTime()) || at.getTime() < Date.now()) throw new Error(`bad time: ${when}`);
		await schedule(chatId, at, t.join(" "));
		break;
	}
	case "scheduled": {
		if (!rest[0]) throw new Error("usage: scheduled <chatId>");
		await listScheduled(rest[0]);
		break;
	}
	case "broadcast": {
		const text = flag(rest, "--text");
		const card = flag(rest, "--card");
		if (!text && !card) throw new Error("usage: broadcast (--text <t> | --card <id>) [--only <chatId,..>] [--yes]");
		const only = flag(rest, "--only")?.split(",");
		const yes = rest.includes("--yes");
		let targets = await listChats();
		if (only) targets = targets.filter((c) => only.includes(c.chatId));
		console.log(`targets: ${targets.length}${yes ? "" : " (dry-run: --yes で送信)"}`);
		for (const c of targets) console.log(`  ${c.chatId}\t${chatName(c)}`);
		if (!yes) break;
		for (const [i, c] of targets.entries()) {
			const status = text ? await sendText(c.chatId, text) : await sendCard(c.chatId, Number(card));
			console.log(`${i + 1}/${targets.length}\t${c.chatId}\t${chatName(c)}\t${status}`);
			if (i < targets.length - 1) await sleep(GAP_MS);
		}
		break;
	}
	default:
		console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
}
