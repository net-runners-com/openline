// 個人LINEの最近のトーク(messageBox)を列挙する。
//   bun run list-chats.ts
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
const STORAGE = process.env.ACCOUNT ? `./storage.${process.env.ACCOUNT}.json` : "./storage.json";
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached as string, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
console.log("ME:", me.displayName, me.mid);

const talk = client.base.talk;
// 全メッセージボックス
try {
	const boxes = await talk.getMessageBoxes({ messageBoxListRequest: { messageBoxCategoryType: 0, lastMessagesPerMessageBoxCount: 1, withUnreadCount: true } });
	const list = (boxes as any).messageBoxes ?? [];
	console.log("TOTAL_BOXES:", list.length);
	const Q = (process.env.Q ?? "").toLowerCase();
	for (const b of list) {
		const mid = String(b.id ?? b.midType ?? "?");
		if (Q && !mid.toLowerCase().includes(Q)) continue;
		const unread = b.unreadCount ?? 0;
		const last = (b.lastMessages ?? [])[0];
		const txt = last?.text ?? `[${last?.contentType ?? "?"}]`;
		const when = last?.createdTime ? new Date(Number(last.createdTime)).toLocaleString("ja-JP") : "?";
		console.log(`${mid}\tunread=${unread}\t${when}\t${(txt ?? "").slice(0, 60)}`);
	}
} catch (e) {
	console.error("getMessageBoxes failed:", String(e).slice(0, 300));
}
process.exit(0);
