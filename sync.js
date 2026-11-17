// Deepcoin 探查 v7：去官方文档里挖接口路径 + 带参数试探余额接口
// 只报告路径与状态码，不写持仓明细

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

function sign(ts, path) {
  return crypto.createHmac('sha256', SECRET).update(ts + 'GET' + path + '').digest('base64');
}

async function apiGet(path) {
  const ts = new Date().toISOString();
  const headers = {
    'DC-ACCESS-KEY': KEY,
    'DC-ACCESS-SIGN': sign(ts, path),
    'DC-ACCESS-TIMESTAMP': ts,
    'DC-ACCESS-PASSPHRASE': PASS || '',
    'Content-Type': 'application/json',
  };
  try {
    const res = await fetch(BASE + path, { method: 'GET', headers });
    const text = await res.text();
    return { path, status: res.status, len: text.length, head: res.status === 200 ? text.slice(0, 1) : text.slice(0, 40) };
  } catch (e) {
    return { path, status: 0, head: '网络失败:' + e.message };
}
}

// 带参数的候选（参数不同可能对应不同账户）
const PROBE = [
  '/deepcoin/account/balances?instType=SWAP',
  '/deepcoin/account/balances?accountType=CONTRACT',
  '/deepcoin/account/balances?type=swap',
  '/deepcoin/account/balances?ccy=USDT',
  '/deepcoin/account/positions?instType=SWAP',
  '/deepcoin/account/positions?productType=USDT-FUTURES',
  '/deepcoin/account/positions?type=swap',
  '/deepcoin/account/positions?ccy=USDT',
  '/deepcoin/account/balance/contract',
  '/deepcoin/account/account',
  '/deepcoin/account',
  '/deepcoin/account/unified/balance',
  '/deepcoin/account/margin/balance',
  '/deepcoin/account/swap/account',
  '/deepcoin/account/contract/account',
  '/deepcoin/account/contract/asset',
  '/deepcoin/account/futures/account',
  '/deepcoin/account/futures/asset',
  '/deepcoin/account/wallet',
  '/deepcoin/account/wallets',
  '/deepcoin/trade/account',
  '/deepcoin/trade/balance',
  '/deepcoin/swap/account',
  '/deepcoin/swap/balance',
];

const DOC_SEEDS = [
  'https://www.deepcoin.com/docs',
'https://www.deepcoin.com/docs/zh',
  'https://www.deepcoin.com/sitemap.xml',
  'https://www.deepcoin.com/docs/zh/quick-start',
  'https://www.deepcoin.com/docs/zh/authentication',
];

async function mineDocs() {
  const seen = new Set();
  const hits = new Set();
  const log = [];
  const queue = [...DOC_SEEDS];

  while (queue.length && log.length < 10) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let html = '';
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
      html = await r.text();
      log.push({ url: url.slice(-50), status: r.status, bytes: html.length });
    } catch (e) {
      log.push({ url: url.slice(-50), status: 0 });
      continue;
    }
    if (!html) continue;

    for (const m of html.matchAll(/\/deepcoin\/[A-Za-z0-9_\-/]{2,60}/g)) hits.add(m[0]);

    for (const m of html.matchAll(/href=["']([^"']*docs[^"']*)["']/g)) {
      const u = m[1].startsWith('http') ? m[1] : new URL(m[1], url).toString();
if (queue.length < 12 && !seen.has(u)) queue.push(u);
    }
    for (const m of html.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (/docs/.test(m[1]) && queue.length < 12) queue.push(m[1]);
    }
  }

  return { log, hits: Array.from(hits).slice(0, 100) };
}

async function main() {
  const out = { total: null, updated_at: new Date().toISOString(), step: 'v7', probed: [] };
  if (!KEY || !SECRET) {
    out.error = '缺少密钥';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    return;
  }

  for (const p of PROBE) {
    const r = await apiGet(p);
    out.probed.push(r);
    console.log(p, '->', r.status);
  }

  try { out.docs = await mineDocs(); } catch (e) { out.docs = { error: String(e.message).slice(0, 60) }; }

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('ok');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
});
