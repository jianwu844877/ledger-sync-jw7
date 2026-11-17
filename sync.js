// Deepcoin 接口探查脚本 v5（在 GitHub Actions 里运行，只读，只报告状态，不写持仓明细）
// 目的：
//   1) 试探一批候选接口，看哪个返回 200（找"合约账户"余额接口）
//   2) 抓交易所网页的 JS，把里面出现的 /deepcoin/... 接口路径提取出来
// 输出：只写接口路径和状态码，不写任何金额明细

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

function sign(ts, path) {
  return crypto.createHmac('sha256', SECRET).update(ts + 'GET' + path + '').digest('base64');
}

const PROBE = [
  '/deepcoin/account/balances',
  '/deepcoin/account/contract/balances',
  '/deepcoin/account/futures/balances',
  '/deepcoin/account/swap/balances',
  '/deepcoin/account/asset',
  '/deepcoin/account/assets',
  '/deepcoin/account/info',
  '/deepcoin/account/positions',
  '/deepcoin/account/position',
  '/deepcoin/account/contract/position',
  '/deepcoin/account/contract/positions',
  '/deepcoin/account/config',
  '/deepcoin/account/setting',
'/deepcoin/account/sub/list',
  '/deepcoin/market/tickers',
];

async function probe(path) {
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
    return { path, status: res.status, head: res.status === 200 ? '' : text.slice(0, 60).replace(/\s+/g, ' ') };
  } catch (e) {
    return { path, status: 0, head: '网络失败:' + e.message };
  }
}

async function discover() {
  const pages = [
    'https://www.deepcoin.red/zh/my/dashboard',
    'https://www.deepcoin.red/zh/my/balance',
    'https://www.deepcoin.red/',
  ];
  const found = new Set();
  const pageInfo = [];

  for (const page of pages) {
    let html = '';
    try {
      const r = await fetch(page, { headers: { 'user-agent': 'Mozilla/5.0' } });
html = await r.text();
      pageInfo.push({ page, status: r.status, bytes: html.length });
    } catch (e) {
      pageInfo.push({ page, status: 0, note: String(e.message).slice(0, 40) });
      continue;
    }
    if (!html) continue;

    for (const m of html.matchAll(/\/deepcoin\/[A-Za-z0-9_\-/]{2,60}/g)) found.add(m[0]);

    const srcs = new Set();
    for (const m of html.matchAll(/src=["']([^"']+\.js[^"']*)["']/g)) srcs.add(m[1]);
    for (const m of html.matchAll(/href=["']([^"']+\.js[^"']*)["']/g)) srcs.add(m[1]);

    let n = 0;
    for (const s of srcs) {
      if (n >= 8) break;
      n++;
      const url = s.startsWith('http') ? s : new URL(s, page).toString();
      try {
        const jr = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        const jt = await jr.text();
        for (const m of jt.matchAll(/\/deepcoin\/[A-Za-z0-9_\-/]{2,60}/g)) found.add(m[0]);
        pageInfo.push({ js: url.slice(-40), status: jr.status, k: jt.length });
      } catch (e) {
pageInfo.push({ js: url.slice(-40), status: 0 });
      }
    }
  }

  return { pages: pageInfo, paths: Array.from(found).slice(0, 80) };
}

async function main() {
  const out = {
    total: null,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    step: 'probe',
    probed: [],
  };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    return;
  }

  for (const p of PROBE) {
    const r = await probe(p);
    out.probed.push(r);
    console.log(p, '->', r.status);
  }

  try {
    out.discovery = await discover();
  } catch (e) {
    out.discovery = { error: String(e.message).slice(0, 80) };
  }

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 balance.json');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
});
