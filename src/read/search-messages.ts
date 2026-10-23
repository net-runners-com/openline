// 全(or 一定数)メッセージボックスを走査してキーワード検索。
//   bun run search-messages.ts <keyword> [per] [maxBoxes]
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const Q = (process.argv[2] ?? "").toLowerCase();
const PER = Number(process.argv[3] ?? 200);
const MAX_BOXES = Number(process.argv[4] ?? 100);
const I64_MAX = 9223372036854775807n;
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached as string, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.error("ME:", me.displayName);
const talk = client.base.talk;
const e2ee = client.base.e2ee;

const boxes: any = await talk.getMessageBoxes({ messageBoxListRequest: { messageBoxCategoryType: 0, lastMessagesPerMessageBoxCount: 1, withUnreadCount: true } });
const list = (boxes.messageBoxes ?? []).slice(0, MAX_BOXES);
console.error(`BOXES: ${list.length}`);

for (const [idx, b] of list.entries()) {
	const mid = String(b.id ?? "");
	if (!mid) continue;
	let end: any = { deliveredTime: BigInt(Date.now()) + 9_999_999n, messageId: I64_MAX };
	const seen = new Set<string>();
	let fetched = 0;
	let hits = 0;
	let name = "";
	try {
		const info = await talk.getContactsV2({ mids: [mid] });
		const c = (Object.values(info.contacts ?? {})[0] as any)?.contact ?? {};
		name = c.displayNameOverridden || c.displayName || "";
	} catch {}
	while (fetched < PER) {
		try {
			const res: any = await talk.getPreviousMessagesV2WithRequest({
				request: { messageBoxId: mid, endMessageId: end, messagesCount: 50, withReadCount: false, receivedOnly: false },
			});
			const msgs = Array.isArray(res) ? res : (res.messages ?? []);
			if (msgs.length === 0) break;
			let progressed = false;
			for (const m of msgs) {
				const id = String(m.id ?? "");
				if (id && seen.has(id)) continue;
				if (id) seen.add(id);
				progressed = true;
				fetched++;
				if ((m.contentType === "NONE" || !m.text) && m.chunks) { try { await e2ee.decryptE2EEMessage(m); } catch {} }
				const text = String(m.text ?? "");
				if (text && text.toLowerCase().includes(Q)) {
					hits++;
					const when = m.createdTime ? new Date(Number(m.createdTime)).toLocaleString("ja-JP") : "?";
					const who = String(m.from ?? "") === me.mid ? "ME" : "THEM";
					console.log(`[${name || mid.slice(0, 10)}] ${when} ${who}: ${text.replace(/\n/g, "\\n").slice(0, 200)}`);
				}
			}
			if (!progressed) break;
			const oldest = msgs[msgs.length - 1];
			if (!oldest?.id) break;
			end = { deliveredTime: BigInt(oldest.deliveredTime ?? 0), messageId: BigInt(oldest.id) };
		} catch (e) { break; }
	}
	console.error(`${idx + 1}/${list.length} ${name || mid.slice(0, 10)}: ${fetched} msgs, ${hits} hits`);
}
process.exit(0);
