// chat.line.biz の 1 チャットのメッセージ履歴を取得。
//   bun run chatbiz-messages.ts <chatId> [limit]
// 既定 300件。古いものから新しいものへ時系列で出力。
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BOT = process.env.CHATBIZ_BOT ?? "Ub4aa0ca3051d9abc64e21e982ec40537";
const ORIGIN = "https://chat.line.biz";
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(HERE, ".chatbiz-auth.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const chatId = process.argv[2];
const LIMIT = Number(process.argv[3] ?? 300);
if (!chatId) { console.error("usage: bun run chatbiz-messages.ts <chatId> [limit]"); process.exit(1); }

function cookieHeader(): string {
	if (!existsSync(AUTH_FILE)) throw new Error(`no ${basename(AUTH_FILE)} — run: bun run chatbiz.ts auth --login`);
	const state = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as { cookies: Array<{ name: string; value: string; domain: string }> };
	return state.cookies
		.filter((c) => ["chat.line.biz", ".chat.line.biz", ".line.biz"].includes(c.domain))
		.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function api(path: string) {
	const res = await fetch(`${ORIGIN}${path}`, {
		headers: {
			Cookie: cookieHeader(), "User-Agent": UA, Accept: "application/json",
			Origin: ORIGIN, Referer: `${ORIGIN}/${BOT}/chat/${chatId}`,
		},
		redirect: "manual",
	});
	if (res.status >= 300 && res.status < 400) throw new Error(`redirected (${res.status}) — session expired?`);
	if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
	return res.json();
}

type Msg = { messageId?: string; id?: string; type?: string; text?: string; from?: string; createdTime?: number; createdAt?: number; timestamp?: number; [k: string]: unknown };

const all: Msg[] = [];
let backward: string | undefined;
for (let i = 0; i < 50 && all.length < LIMIT; i++) {
	const q = new URLSearchParams({ limit: "50" });
	if (backward) q.set("backward", backward);
	const data = await api(`/api/v3/bots/${BOT}/chats/${chatId}/messages?${q.toString()}`) as { list?: Msg[]; backward?: string; next?: string };
	const msgs = data.list ?? [];
	if (msgs.length === 0) break;
	all.push(...msgs);
	backward = data.backward ?? data.next;
	if (!backward) break;
}

// 時系列(古→新)
all.sort((a, b) => Number(a.createdTime ?? a.createdAt ?? a.timestamp ?? 0) - Number(b.createdTime ?? b.createdAt ?? b.timestamp ?? 0));
const trimmed = all.slice(-LIMIT);

for (const m of trimmed) {
	const t = Number(m.createdTime ?? m.createdAt ?? m.timestamp ?? 0);
	const when = t ? new Date(t).toLocaleString("ja-JP") : "?";
	const who = (m as any).side === "O" || (m as any).from === "operator" || (m as any).senderType === "OPERATOR" ? "OA" : "USER";
	const body = m.text ?? `[${m.type ?? "?"}]`;
	console.log(`${when}\t${who}\t${(body as string).replace(/\n/g, "\\n")}`);
}
console.error(`\n--- ${trimmed.length} msgs (fetched ${all.length}, limit ${LIMIT}) ---`);
