// 相手の E2EE 公開鍵 fingerprint を取得する CLI。
// 相手と対面で fingerprint を比較すれば、MITM が居ないか確認できる (Signal 的な safety number)。
//
//   bun run src/read/e2ee-fingerprint.ts <相手名|mid>
import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { createHash } from "node:crypto";

const WHO = process.argv[2];
if (!WHO) { console.error("usage: bun run src/read/e2ee-fingerprint.ts <相手名|mid>"); process.exit(1); }

const STORAGE = `./storage/${process.env.ACCOUNT ?? "main"}.json`;
const storage = new FileStorage(STORAGE);
const cached = await storage.get(".auth");
if (typeof cached !== "string") { console.error(`未ログイン(${STORAGE})`); process.exit(1); }
const DEVICE = ((await storage.get(".device")) ?? "DESKTOPWIN") as any;
const client = await loginWithAuthToken(cached, { device: DEVICE, storage });
await storage.set(".auth", client.authToken);
const talk = client.base.talk;

async function resolveMid(): Promise<string> {
	if (/^u[0-9a-f]{32}$/.test(WHO)) return WHO;
	const { userFriendMids } = await client.base.relation.getUserFriendIds({ request: { blockStatus: "ALL" } });
	const mids: string[] = userFriendMids ?? [];
	const q = WHO.toLowerCase();
	const hits: { mid: string; name: string }[] = [];
	for (let i = 0; i < mids.length; i += 20) {
		const r: any = await talk.getContactsV2({ mids: mids.slice(i, i + 20) });
		for (const [mid, entry] of Object.entries(r.contacts ?? {})) {
			const c = (entry as any)?.contact ?? {};
			const name = [c.displayNameOverridden, c.displayName].filter(Boolean).join(" / ");
			if (name.toLowerCase().includes(q)) hits.push({ mid, name });
		}
	}
	if (hits.length === 0) { console.error(`「${WHO}」なし`); process.exit(1); }
	if (hits.length > 1) { console.error(`${hits.length} 件`); process.exit(1); }
	return hits[0].mid;
}

const mid = await resolveMid();
console.log(`mid: ${mid}`);
try {
	const r: any = await talk.getLastE2EEPublicKeys({ mids: [mid] });
	const keys = r?.publicKeys ?? r?.success ?? {};
	const key = Array.isArray(keys) ? keys[0] : keys[mid];
	if (!key) { console.log("公開鍵情報なし"); process.exit(0); }
	const keyBytes: Uint8Array = key?.keyData ?? key?.publicKey ?? new Uint8Array();
	const fp = createHash("sha256").update(Buffer.from(keyBytes as any)).digest("hex");
	console.log(`keyId: ${key?.keyId ?? "?"}`);
	console.log(`keyVersion: ${key?.keyVersion ?? "?"}`);
	console.log(`fingerprint (sha256): ${fp}`);
	console.log(`short fp (先頭 10 chars): ${fp.slice(0, 10)}`);
} catch (e: any) {
	// 単発版も試す
	try {
		const r2: any = await talk.getE2EEPublicKey({ mid, keyVersion: 1, keyId: -1 });
		console.log("getE2EEPublicKey:", JSON.stringify(r2, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 500));
	} catch (e2: any) {
		console.error(`失敗: ${JSON.stringify(e?.data ?? e2?.data ?? {}).slice(0, 300)}`);
		process.exit(1);
	}
}
process.exit(0);
