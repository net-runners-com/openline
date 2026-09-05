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

// カード一覧（manager.line.biz で作ったカードタイプメッセージ。messageObject に Flex 全文）
async function chatbizCards() {
  const r = await fetch(`/api/v1/bots/${CHATBIZ_BOT}/cardTypeMessages?limit=25`, { credentials: 'include' });
  const rows = ((await r.json()).list || []).map((c) => ({ id: c.id, title: c.title, type: c.type }));
  console.table(rows);
  return rows;
}

// カード送信（ID 指定。任意の Flex は 400 not_supported_message_type）
async function chatbizSendCard(chatId, cardTypeMessageId) {
  if (!chatId || !cardTypeMessageId) throw new Error('usage: chatbizSendCard(chatId, cardTypeMessageId)');
  const csrf = await chatbizCsrf();
  const r = await fetch(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/send`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: JSON.stringify({ id: '', type: 'cardType', cardTypeMessageId, sendId: crypto.randomUUID() }),
  });
  console.log('send status', r.status);
  return r.status;
}

console.log('loaded: chatbizChats / chatbizSend / chatbizSendMany / chatbizCards / chatbizSendCard / chatbizSendSticker / chatbizSendCoupon / chatbizSendFile / chatbizSchedule / chatbizScheduled / chatbizSavedReplyCreate / chatbizSavedReplies');

// 複数通を上限内で順送り。上限は 1 チャット 20 通 / 60 秒（chatbiz.md「送信レート上限」）。
// 429 が返ったら 60 秒待って同じメッセージを再送する。
async function chatbizSendMany(chatId, texts, gapMs = 3100) {
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    let status = await chatbizSend(chatId, texts[i]);
    if (status === 429) {
      console.log(`429 at #${i + 1}, waiting 60s`);
      await new Promise((r) => setTimeout(r, 60000));
      status = await chatbizSend(chatId, texts[i]);
    }
    results.push({ n: i + 1, status });
    if (i < texts.length - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  console.table(results);
  return results;
}

// --- 追加タイプ（2026-09-01 実測。chatbiz.md「chat 経路で送れる全タイプ」） ---
async function chatbizPost(path, body) {
  const csrf = await chatbizCsrf();
  const isForm = body instanceof FormData;
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: isForm ? { 'X-XSRF-TOKEN': csrf } : { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: isForm ? body : JSON.stringify(body),
  });
  const text = await r.text();
  console.log(r.status, text.slice(0, 200));
  return { status: r.status, body: text };
}

// スタンプ（公式無料セット例: packageId 11537, stickerId 52002734〜52002770）
const chatbizSendSticker = (chatId, packageId, stickerId) =>
  chatbizPost(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/send`, { type: 'sticker', packageId: String(packageId), stickerId: String(stickerId), sendId: crypto.randomUUID() });

// クーポン（manager.line.biz で作成した couponId）
const chatbizSendCoupon = (chatId, couponId) =>
  chatbizPost(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/send`, { type: 'coupon', couponId: String(couponId), sendId: crypto.randomUUID() });

// 画像/ファイル（file は File/Blob。PNG で確認済み）
function chatbizSendFile(chatId, file, filename = 'image.png') {
  const fd = new FormData();
  fd.append('file', file, filename);
  fd.append('sendId', crypto.randomUUID());
  return chatbizPost(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/sendFile`, fd);
}

// 予約送信。at は Date か epoch ms。type は textV2 でないと 400
const chatbizSchedule = (chatId, text, at) =>
  chatbizPost(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/scheduled`, { message: { id: '', type: 'textV2', text }, scheduledAt: +new Date(at) });

async function chatbizScheduled(chatId) {
  const r = await fetch(`/api/v1/bots/${CHATBIZ_BOT}/chats/${chatId}/messages/scheduled`, { credentials: 'include' });
  const rows = ((await r.json()).list || []).map((s) => ({ id: s.scheduledMessageId, at: new Date(s.scheduledAt).toLocaleString(), status: s.status, text: s.message && s.message.text }));
  console.table(rows);
  return rows;
}

// 定型文の作成・一覧
const chatbizSavedReplyCreate = (title, text) =>
  chatbizPost(`/api/v2/bots/${CHATBIZ_BOT}/savedReplies`, { title, message: { type: 'text', text }, isFavorite: false });

async function chatbizSavedReplies() {
  const r = await fetch(`/api/v2/bots/${CHATBIZ_BOT}/savedReplies?query=&excludeUsernamePlaceholder=false&sortKey=CREATED_AT&pageSize=25&page=1`, { credentials: 'include' });
  const rows = ((await r.json()).list || []).map((s) => ({ id: s.savedReplyId, title: s.title, text: s.message && s.message.text }));
  console.table(rows);
  return rows;
}
