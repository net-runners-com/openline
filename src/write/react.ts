// グループ or DM のメッセージに Reaction (ハート/いいね等) を付ける CLI。
//
//   bun run src/write/react.ts <messageId> <type> [--chat <chatMid>] [--yes]
//     type: NICE | LOVE | FUN | AMAZING | SAD | OMG | UNDO | ALL
//
//   bun run src/write/react.ts 123456789 LOVE --yes
//   bun run src/write/react.ts 123456789 UNDO --yes   # 自分の reaction を消す
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		chat: { type: "string" },
		yes: { type: "boolean", short: "y", default: false },
	},
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 2) die(`usage: bun run src/write/react.ts <messageId> <type: NICE|LOVE|FUN|AMAZING|SAD|OMG|UNDO|ALL> [--yes]`);
const [MSG_ID, RTYPE] = positionals;
const VALID = ["NICE", "LOVE", "FUN", "AMAZING", "SAD", "OMG", "UNDO", "ALL"];
if (!VALID.includes(RTYPE)) die(`type は ${VALID.join("|")} のいずれか`);

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((process.env.DEVICE ?? (await storage.get(".device"))) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();
const talk = client.base.talk;

console.log(`アカウント: ${me.displayName}`);
console.log(`messageId: ${MSG_ID}`);
console.log(`reaction:  ${RTYPE}`);
if (!opt.yes) { console.log("[dry-run] 送信するには --yes を付けてください。"); process.exit(0); }

try {
	if (RTYPE === "UNDO") {
		await talk.cancelReaction({ reqSeq: Number(await client.base.getReqseq("talk")), messageId: MSG_ID });
	} else {
		await talk.react({ reactRequest: { reqSeq: Number(await client.base.getReqseq("talk")), messageId: MSG_ID, reactionType: { predefinedReactionType: RTYPE } } });
	}
	console.log("✓ reaction 送信");
} catch (e: any) {
	console.error(`失敗: ${e?.data?.code ?? ""} ${e?.data?.reason ?? e?.message?.slice(0, 200)}`);
	process.exit(1);
}
process.exit(0);
