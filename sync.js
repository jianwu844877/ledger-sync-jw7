// Deepcoin 余额同步（正式版）
// 读合约账户权益（含浮动盈亏），写入 balance.json
// 接口：GET /deepcoin/account/balances?instType=SWAP
// 字段：equity = 权益（含浮盈浮亏），bal = 钱包余额（不含浮盈亏）

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

function sign(ts, path) {
  return crypto.createHmac('sha256', SECRET).update(ts + 'GET' + path + '').digest('base64');
}

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

async function get(path) {
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
    return { status: res.status, json, raw: text };
  } catch (e) {
    return { status: 0, json: null, raw: '网络失败:' + String(e && e.message) };
  }
}

function listOf(json) {
  if (!json) return [];
  const d = json.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  return [];
}

async function main() {
  const out = { total: 0, currency: 'USD', source: 'deepcoin', updated_at: new Date().toISOString() };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }

  // 合约账户：权益（含浮动盈亏）
  const swap = await get('/deepcoin/account/balances?instType=SWAP');
  const swapList = listOf(swap.json);
  let equitySum = 0, balSum = 0, hasEquity = false;
  for (const it of swapList) {
    const eq = toNum(it.equity);
    const bal = toNum(it.bal);
    if (eq != null) { equitySum += eq; hasEquity = true; }
    if (bal != null) balSum += bal;
  }

  // 资金账户：一并计入
  const fund = await get('/deepcoin/account/balances');
  let fundEquity = 0;
  for (const it of listOf(fund.json)) {
    const eq = toNum(it.equity);
    if (eq != null) fundEquity += eq;
  }

  const total = (hasEquity ? equitySum : balSum) + fundEquity;
  out.total = Math.round(total * 100) / 100;
  if (swap.status !== 200) out.warning = '合约接口返回 ' + swap.status;

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('total', out.total);
}

main().catch((e) => {
  const out = { total: 0, error: String(e && e.message ? e.message : e), updated_at: new Date().toISOString() };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
});
