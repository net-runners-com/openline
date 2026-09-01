// chat.line.biz の DevTools コンソールに貼って使う。
// 前提: manager.line.biz でチャット ON、chat.line.biz にログイン済み。
// Messaging API ではない内部 API。来た人への 1対1 返信のみ（初回プッシュ不可）。

const CHATBIZ_BOT = 'Ub4aa0ca3051d9abc64e21e982ec40537'; // ひろと@AI屋さん / @492qwqka

async function chatbizCsrf() {
  const t = await (await fetch('/api/v1/csrfToken', { credentials: 'include' })).json();
  return t.token || t.csrfToken;
}

// 会話一覧: chatId と最終メッセージのプレビューを返す
async function chatbizChats(limit = 25) {
  const u = `/api/v2/bots/${CHATBIZ_BOT}/chats?folderType=ALL&tagIds=&autoTagIds=&limit=${limit}&prioritizePinnedChat=true`;
  const r = await fetch(u, { credentials: 'include' });
  const body = await r.json();
  const list = body.list || [];
  const rows = list.map((c) => ({
    chatId: c.chatId,
    lastTalkedAt: c.lastTalkedAt,
    preview: c.latestEvent && c.latestEvent.messages && c.latestEvent.messages[0]
      ? c.latestEvent.messages[0].text : undefined,
  }));
  console.table(rows);
  return rows;
}

// テキスト送信
async function chatbizSend(chatId, text) {
  if (!chatId || !text) throw new Error('usage: chatbizSend(chatId, text)');
  const csrf = await chatbizCsrf();
  const r = await fetch(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/send`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: JSON.stringify({ type: 'text', text, sendId: crypto.randomUUID() }),
  });
  console.log('send status', r.status);
  return r.status;
}

console.log('loaded: chatbizChats() / chatbizSend(chatId, text)');
