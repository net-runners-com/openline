// line-lake Official Account (@492qwqka) sender.
// linejs cannot drive an Official Account — OAs have no client-protocol login.
// This goes through the line-lake harness REST API (Messaging API underneath).
//
//   bun run oa.ts list [filter]
//   bun run oa.ts send <friendId> <text>

const URL_BASE = process.env.LINELAKE_URL ?? "https://hiroto-ai-botch.net";
const API_KEY = process.env.LINELAKE_API_KEY;
if (!API_KEY) throw new Error("LINELAKE_API_KEY required (put it in bot/.env)");

const headers = {
	"Authorization": `Bearer ${API_KEY}`,
	"Content-Type": "application/json",
};

const [cmd, ...rest] = process.argv.slice(2);

async function friends() {
	const res = await fetch(`${URL_BASE}/api/friends`, { headers });
	if (!res.ok) throw new Error(`GET /api/friends -> ${res.status}`);
	const body = await res.json();
	return body.data.items as Array<{
		id: string;
		displayName: string | null;
		isFollowing: boolean;
		isBlocked: boolean;
	}>;
}

if (cmd === "list") {
	const filter = rest[0]?.toLowerCase();
	const items = await friends();
	console.log(`# friends (${items.length})`);
	for (const f of items) {
		const name = f.displayName ?? "";
		if (filter && !name.toLowerCase().includes(filter)) continue;
		const flags = [
			f.isFollowing ? "following" : "unfollowed",
			f.isBlocked ? "BLOCKED" : "",
		].filter(Boolean).join(",");
		console.log(`${f.id}\t${name}\t${flags}`);
	}
} else if (cmd === "send") {
	const [friendId, ...textParts] = rest;
	const text = textParts.join(" ");
	if (!friendId || !text) throw new Error("usage: oa.ts send <friendId> <text>");

	const target = (await friends()).find((f) => f.id === friendId);
	if (!target) throw new Error(`friendId not found: ${friendId}`);
	console.log(`SENDING_TO: ${target.displayName ?? "(no name)"} (${friendId})`);

	const res = await fetch(`${URL_BASE}/api/friends/${friendId}/messages`, {
		method: "POST",
		headers,
		body: JSON.stringify({ messageType: "text", content: text }),
	});
	const body = await res.text();
	console.log(`HTTP ${res.status}:`, body);
	if (!res.ok) process.exit(1);
} else {
	console.log("usage: bun run oa.ts list [filter] | send <friendId> <text>");
	process.exit(1);
}
