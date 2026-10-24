// LYP Premium の「通知なしで送信取消」(silentlyUnsendMessage) CLI。
// 通常の unsendMessage は相手の既読が未読のとき相手に "〜が送信を取消しました" が残るが、
// silentlyUnsendMessage は相手が未読なら完全に静かに消える(通知も残らない)。
//
// APK decompile で見つけた thrift schema (sources/hi8/oo.java, ch.java):
//   silentlyUnsendMessage_args: { silentlyUnsendMessageRequest: { reqSeq: i32, messageId: string } }
//
// 前提: LYP Premium 加入済み + スマホ本体で機能の規約同意完了
//
//   bun run src/write/silent-unsend.ts <messageId> [--yes]
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { LINEStruct } from "@evex/linejs/thrift";
import { parseArgs } from "node:util";

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: { yes: { type: "boolean", short: "y", default: false } },
});
function die(m: string): never { console.error(m); process.exit(1); }
if (positionals.length !== 1) die(`usage: bun run src/write/silent-unsend.ts <messageId> [--yes]`);
const MSG_ID = positionals[0];

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
console.log(`方式:       silentlyUnsendMessage (Premium: 通知なしで取消)`);
if (!opt.yes) { console.log("[dry-run] 実行するには --yes を付けてください。"); process.exit(0); }

const reqSeq = Number(await client.base.getReqseq("talk"));
// silentlyUnsendMessage_args: [[12, 1, SilentlyUnsendMessageRequest]]
// SilentlyUnsendMessageRequest: [[8, 1, reqSeq], [11, 2, messageId]]
const silentReq = [[8, 1, reqSeq], [11, 2, MSG_ID]];
const args = [[12, 1, silentReq]];

try {
	const res: any = await (client.base as any).request.request(args, "silentlyUnsendMessage", 4, true, "/S4");
	console.log("✓ 取消成功 (silently):", JSON.stringify(res, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 300));
} catch (e: any) {
	const data = e?.data ?? {};
	const code = data?.["1"]?.["1"] ?? data?.code ?? "?";
	const reason = data?.["1"]?.["2"] ?? data?.reason ?? JSON.stringify(data).slice(0, 200);
	console.error(`✗ 失敗 [code=${code}]: ${reason}`);
	if (String(reason).includes("non-LYP") || String(reason).includes("PREMIUM")) {
		console.error("→ LYP Premium 必須。スマホで機能の規約同意が別途必要な可能性。");
	}
	process.exit(1);
}
process.exit(0);
