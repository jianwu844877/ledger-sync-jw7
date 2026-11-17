// Deepcoin 余额读取 v8 —— 取"含浮盈浮亏"的合约账户权益
// 关键：余额接口带 instType=SWAP 才是合约账户
// 输出：只写总资产与汇总数字，不写逐币持仓明细

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
  }
}

function listOf(json) {
  if (!json) return [];
  const d = json.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  return [];
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
function keysOf(v, depth) {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return { array: v.length, item: depth < 1 && v[0] ? keysOf(v[0], depth + 1) : '(省略)' };
  const o = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val && typeof val === 'object') o[k] = keysOf(val, depth + 1);
    else if (typeof val === 'string') o[k] = NUM_RE.test(val.trim()) ? '数值' : '文本';
    else o[k] = typeof val;
  }
  return o;
}

async function main() {
  const out = {
    total: null,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    detail: {},
  };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    return;
  }

  // 1) 合约账户（关键参数 instType=SWAP）
  const swap = await get('/deepcoin/account/balances?instType=SWAP');
  const swapList = listOf(swap.json);
  let sEquity = 0, sBal = 0, sUnreal = 0, sHit = false;
  for (const it of swapList) {
    const eq = toNum(it.equity), bal = toNum(it.bal), un = toNum(it.unrealizedProfit);
    if (eq != null) { sEquity += eq; sHit = true; }
    if (bal != null) sBal += bal;
    if (un != null) sUnreal += un;
  }
  out.detail.contract = { status: swap.status, count: swapList.length, keys: keysOf(swapList[0], 0) };

  // 2) 资金/现货账户
  const fund = await get('/deepcoin/account/balances');
  const fundList = listOf(fund.json);
  let fEquity = 0, fBal = 0;
  for (const it of fundList) {
    const eq = toNum(it.equity), bal = toNum(it.bal);
    if (eq != null) fEquity += eq;
    if (bal != null) fBal += bal;
  }
  out.detail.funding = { status: fund.status, count: fundList.length, equitySum: Math.round(fEquity * 100) / 100, balSum: Math.round(fBal * 100) / 100 };
// 3) 持仓里的未实现盈亏（兜底用）
  const pos = await get('/deepcoin/account/positions?instType=SWAP');
  const posList = listOf(pos.json);
  let pUnreal = 0;
  for (const it of posList) {
    const v = toNum(it.unrealizedProfit) ?? toNum(it.upl) ?? toNum(it.profit);
    if (v != null) pUnreal += v;
  }
  out.detail.positions = { status: pos.status, count: posList.length, unrealSum: Math.round(pUnreal * 100) / 100, keys: keysOf(posList[0], 0) };

  // 候选口径（只写汇总额，便于核对哪个对得上账户总览）
  out.detail.candidates = {
    A_合约权益求和: Math.round(sEquity * 100) / 100,
    B_合约钱包余额求和: Math.round(sBal * 100) / 100,
    C_合约权益加资金: Math.round((sEquity + fEquity) * 100) / 100,
    D_合约钱包余额加未实现: Math.round((sBal + sUnreal) * 100) / 100,
    E_合约钱包余额加持仓未实现: Math.round((sBal + pUnreal) * 100) / 100,
  };

  // 默认取 A：合约权益（通常已含浮盈浮亏），加资金账户权益
  const total = sHit ? sEquity + fEquity : fEquity;
  out.total = Math.round(total * 100) / 100;

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('total', out.total);
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
});
