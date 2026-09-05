// manager.line.biz を開いた状態の DevTools コンソールに貼って使う（chat.line.biz とは別オリジン）。
// 画像アップロード → カード作成 → 返ってきた id を chatbiz-send.js の chatbizSendCard に渡す。
// スキーマの出典: bot/chatbiz.md「カードを API で作る」

const MANAGER_ACCOUNT = '@492qwqka';
const MANAGER_API = `/api/bots/${MANAGER_ACCOUNT}/cardTypeMessages`;

function managerXsrf() {
  const c = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('XSRF-TOKEN='));
  if (!c) throw new Error('XSRF-TOKEN cookie not found (manager.line.biz にログインしているか確認)');
  return decodeURIComponent(c.slice('XSRF-TOKEN='.length));
}

function managerHeaders(json = true) {
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-XSRF-TOKEN': managerXsrf(),
    'X-BotCms-ScriptRevision': '90.0.0',
  };
}

// 画像アップロード。file は File/Blob。戻り値は imageUrl（card.image に渡す）
async function managerUploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${MANAGER_API}/image`, { method: 'POST', credentials: 'include', headers: managerHeaders(false), body: fd });
  const body = await r.json().catch(() => ({}));
  console.log('upload status', r.status, body);
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return body.imageUrl;
}

// --- 部品 ---
const icon = (name) => ({ enable: !!name, name: name || '', color: 'info' });
const image = (src) => (src ? { isNoImage: false, maxFile: 1, list: [{ src }] } : { isNoImage: true, maxFile: 1, list: [{ src: '' }] });
const desc = (value) => ({ enable: !!value, value: value || '' });
const noLink = () => ({ enable: false, title: '', type: 'Choice', url: '' });
// action: {label, url} → Link / {label, text} → Text（タップで相手がそのテキストを送る）
function link(a) {
  if (!a) return noLink();
  if (a.url) return { enable: true, title: a.label || '開く', type: 'Link', url: a.url, shopCard: '', urlInput: a.url };
  if (a.text) return { enable: true, title: a.label || '送る', type: 'Text', shopCard: '', message: a.text };
  return noLink();
}

// 型別カード。共通: image(imageUrl), actions[0..1]
const cardBuilders = {
  // {title, tag, image, description, price, unit('¥' 等), actions}
  Product: (c) => ({ title: c.title, icon: icon(c.tag), image: image(c.image), description: desc(c.description), price: { enable: c.price != null, value: c.price == null ? '' : String(c.price), unit: c.unit || 'none' }, links: [link(c.actions?.[0]), link(c.actions?.[1])] }),
  // {title, tag, image, hours | priceInfo, address, actions}
  Place: (c) => ({ title: c.title, icon: icon(c.tag), image: image(c.image), info: { enable: !!(c.hours || c.priceInfo), type: c.priceInfo ? 'oa.cardmessage.dropdown.infoprice' : 'oa.cardmessage.dropdown.infohours', value: c.priceInfo || c.hours || '' }, place: { enable: !!c.address, value: c.address || '', lat: 0, lng: 0 }, links: [link(c.actions?.[0]), link(c.actions?.[1])] }),
  // {name, tags:[..3], image, description, actions}
  Person: (c) => ({ image: image(c.image), name: c.name, icons: [icon(c.tags?.[0]), icon(c.tags?.[1]), icon(c.tags?.[2])], description: desc(c.description), links: [link(c.actions?.[0]), link(c.actions?.[1])] }),
  // {tag, image(必須), action}  ← 画像1枚+ボタン。リッチメッセージに一番近い
  Image: (c) => ({ icon: icon(c.tag), image: image(c.image), link: link(c.action) }),
};

// カード作成。type: Product|Place|Person|Image、cards は type に応じた定義の配列（複数でカルーセル、UI 上限 9）
async function managerCreateCard(title, type, cards) {
  const build = cardBuilders[type];
  if (!title || !build || !cards?.length) throw new Error('usage: managerCreateCard(title, "Product|Place|Person|Image", [card, ...])');
  const origin = {
    title, type,
    messages: cards.map(build),
    viewmore: { enable: false, type: 'ADDITIONAL_SIMPLE', images: [{ src: '' }], link: noLink() },
  };
  const r = await fetch(MANAGER_API, { method: 'POST', credentials: 'include', headers: managerHeaders(), body: JSON.stringify({ title, type, actions: [], origin }) });
  const body = await r.json().catch(() => ({}));
  console.log('create status', r.status, body);
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
  return body.id;
}

async function managerDeleteCard(id) {
  const r = await fetch(`${MANAGER_API}/${id}`, { method: 'DELETE', credentials: 'include', headers: managerHeaders() });
  console.log('delete status', r.status);
  return r.status;
}

console.log('loaded: managerUploadImage(file) / managerCreateCard(title, type, cards) / managerDeleteCard(id)');
