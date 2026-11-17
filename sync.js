// Deepcoin 探查 v6：找"合约账户权益"接口 + 看持仓/资金接口的字段结构
// 只写字段名与路径，不写具体金额

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

function sign(ts, path) {
  return crypto.createHmac('sha256', SECRET).update(ts + 'GET' + path + '').digest('base64');
}

async function call(path) {
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
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { path, status: res.status, json, head: res.status === 200 ? '' : text.slice(0, 60) };
  } catch (e) {
return { path, status: 0, head: '网络失败:' + e.message };
  }
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
function schemaOf(v, depth) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return { array: v.length, item: depth < 2 && v.length ? schemaOf(v[0], depth + 1) : '(省略)' };
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = schemaOf(v[k], depth + 1);
    return { object: o };
  }
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return NUM_RE.test(v.trim()) ? '数值字符串' : '文本';
  return typeof v;
}

// 从 JS / HTML 里扒可能的接口路径
async function discover() {
  const pages = ['https://www.deepcoin.red/zh/my/dashboard', 'https://www.deepcoin.red/'];
  const hits = new Set();
  const info = [];

  for (const page of pages) {
    let html = '';
    try {
      const r = await fetch(page, { headers: { 'user-agent': 'Mozilla/5.0' } });
      html = await r.text();
      info.push({ page, status: r.status, bytes: html.length });
    } catch (e) { continue; }
if (!html) continue;

    // 页面里所有含 account / balance / equity / asset 的短字符串
    for (const m of html.matchAll(/["'`](\/[a-zA-Z0-9_\-/{}.:]{4,70})["'`]/g)) {
      if (/account|balance|asset|equity|position|wallet/i.test(m[1])) hits.add(m[1]);
    }
    // API 域名相关
    for (const m of html.matchAll(/(https?:\/\/api\.deepcoin\.com[^"'`\s]{0,60})/g)) hits.add(m[1]);

    const srcs = new Set();
    for (const m of html.matchAll(/src=["']([^"']+\.js[^"']*)["']/g)) srcs.add(m[1]);
    let n = 0;
    for (const s of srcs) {
      if (n >= 6) break; n++;
      const url = s.startsWith('http') ? s : new URL(s, page).toString();
      try {
        const jr = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        const jt = await jr.text();
        for (const m of jt.matchAll(/["'`](\/[a-zA-Z0-9_\-/{}.:]{4,70})["'`]/g)) {
          if (/account|balance|asset|equity|position|wallet/i.test(m[1])) hits.add(m[1]);
        }
        // 形如 account/xxx 的无前缀片段
        for (const m of jt.matchAll(/["'`](account\/[a-zA-Z0-9_\-/]{2,50})["'`]/g)) hits.add(m[1]);
} catch (e) {}
    }
  }
  return { info, hits: Array.from(hits).slice(0, 120) };
}

async function main() {
  const out = { total: null, currency: 'USD', updated_at: new Date().toISOString(), step: 'v6' };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    return;
  }

  const b = await call('/deepcoin/account/balances');
  out.balances = { status: b.status, schema: b.json ? schemaOf(b.json, 0) : b.head };

  const p = await call('/deepcoin/account/positions');
  out.positions = { status: p.status, schema: p.json ? schemaOf(p.json, 0) : p.head };

  try { out.discovery = await discover(); } catch (e) { out.discovery = { error: String(e.message).slice(0, 60) }; }

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('ok');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
});
