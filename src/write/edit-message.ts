// 送信済みメッセージを編集する CLI (LYP Premium の MESSAGE_EDIT 機能)。
// linejs 本体には未実装のため、thrift payload を手製して talk /S4 の editMessage を直接叩く。
// args schema は LINE Android APK を jadx decompile して hi8.bj / hi8.j9 クラスから発見。
//
// 前提:
//   - LYP Premium 加入済み
//   - LINE 公式アプリで Message Edit 機能の規約同意完了 (スマホ本体でメッセ長押し → 編集を一度試す)
//   - 編集対象は自分の送信、送信から N 時間以内 (Premium プランで変動、おそらく 7日)
//
//   bun run src/write/edit-message.ts <messageId> <chatMid> "新しい本文" [--yes]
//   bun run src/write/edit-message.ts <messageId> <uMid> "..."         # DM の場合は相手 mid
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { LINEStruct } from "@evex/linejs/thrift";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { yes: { type: "boolean", short: "y", default: false } },
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 3) die(`usage: bun run src/write/edit-message.ts <messageId> <chatMid> "<新本文>" [--yes]`);
const [MSG_ID, TO, NEW_TEXT] = positionals;
const TO_TYPE = TO.startsWith("c") ? "GROUP" : TO.startsWith("u") ? "USER" : TO.startsWith("r") ? "ROOM" : die("to の prefix 不正(u/c/r のみ)");

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") die(`未ログイン(${STORAGE})`);
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const me = await client.getMyProfile();

console.log(`アカウント:  ${me.displayName}`);
console.log(`messageId:  ${MSG_ID}`);
console.log(`宛先:       ${TO} (${TO_TYPE})`);
console.log(`新本文:     ${NEW_TEXT}`);
if (!opt.yes) { console.log("[dry-run] 編集するには --yes を付けてください。"); process.exit(0); }

const reqSeq = Number(await client.base.getReqseq("talk"));
const message = {
	from: me.mid,
	to: TO,
	toType: TO_TYPE,
	id: MSG_ID,
	text: NEW_TEXT,
	contentType: "NONE",
	contentMetadata: {},
};
// 手製 thrift args: [[12, 1, EditMessageRequest]]
// EditMessageRequest: [[8, 1, reqSeq], [12, 2, Message]]
const editReq = [[8, 1, reqSeq], [12, 2, (LINEStruct as any).Message(message)]];
const args = [[12, 1, editReq]];

try {
	const res: any = await (client.base as any).request.request(args, "editMessage", 4, true, "/S4");
	console.log("✓ 編集成功:", JSON.stringify(res, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 300));
} catch (e: any) {
	const data = e?.data ?? {};
	const code = data?.["1"]?.["1"] ?? "?";
	const reason = data?.["1"]?.["2"] ?? JSON.stringify(data).slice(0, 200);
	console.error(`✗ 編集失敗 [code=${code}]: ${reason}`);
	if (String(reason).includes("non-LYP")) {
		console.error("→ LYP Premium 必須。加入済みでも「メッセージ編集」機能の規約同意が別途必要な可能性 (LINE アプリで自分の送信済みメッセを長押し → 編集 UI を一度触る)。");
	}
	process.exit(1);
}
process.exit(0);
