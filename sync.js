// Deepcoin 余额读取脚本 v3（在 GitHub Actions 里运行）
// 已确认正确路径：/deepcoin/account/balances（返回 200）
// v3：读取接口的数据结构（只记录字段名与类型，不记录每个币种的具体数量），据此确定总资产字段

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const PATH = '/deepcoin/account/balances';
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

function sign(secret, ts, path) {
  return crypto.createHmac('sha256', secret).update(ts + 'GET' + path + '').digest('base64');
}

const NUM_RE = /^-?\d+(\.\d+)?$/;

// 只描述结构：字段名 + 类型；深层（数组元素内部）不输出具体数值，避免公开持仓
function schemaOf(v, depth) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    return { array: v.length, item: depth < 2 && v.length ? schemaOf(v[0], depth + 1) : '(省略)' };
  }
  if (typeof v === 'object') {
    const keys = {};
    for (const k of Object.keys(v)) keys[k] = schemaOf(v[k], depth + 1);
    return { object: keys };
  }
  if (typeof v === 'number') return depth <= 1 ? { number: v } : 'number';
if (typeof v === 'string') {
    const isNum = NUM_RE.test(v.trim());
    if (depth <= 1) return { string: v.slice(0, 20) };
    return isNum ? '数值字符串' : '文本';
  }
  return typeof v;
}

async function main() {
  const out = {
    total: null,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    path_used: PATH,
    schema: null,
  };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    console.log(out.error);
    return;
  }

  const ts = new Date().toISOString();
  const headers = {
    'DC-ACCESS-KEY': KEY,
    'DC-ACCESS-SIGN': sign(SECRET, ts, PATH),
    'DC-ACCESS-TIMESTAMP': ts,
    'DC-ACCESS-PASSPHRASE': PASS || '',
    'Content-Type': 'application/json',
  };

  let status = 0, text = '';
  try {
    const res = await fetch(BASE + PATH, { method: 'GET', headers });
    status = res.status;
    text = await res.text();
  } catch (e) {
    out.error = '网络失败:' + e.message;
fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    console.log(out.error);
    return;
  }

  out.http_status = status;
  console.log('HTTP', status);

  let json = null;
  try { json = JSON.parse(text); } catch (e) { out.error = '返回不是 JSON'; }

  if (json) {
    out.schema = schemaOf(json, 0);
  }

  // 尝试在常见位置取总资产（数值或数值字符串都接受）
  const EQ = ['totalEq', 'totalEquity', 'totalUsd', 'usdValue', 'totalBalanceValue',
              'netEquity', 'totalAsset', 'totalBalance', 'equity', 'eq'];
  function grab(o, keys) {
    if (!o || typeof o !== 'object') return null;
    for (const k of keys) {
      const v = o[k];
      if (v != null && NUM_RE.test(String(v).trim())) return Number(v);
    }
    return null;
  }

  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
  let total = grab(data, EQ);
  if (total == null && Array.isArray(data)) {
    let sum = 0, hit = false;
    for (const it of data) {
      const v = grab(it, EQ);
      if (v != null) { sum += v; hit = true; }
    }
    if (hit) total = sum;
  }
  if (total != null) out.total = Math.round(total * 100) / 100;

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 balance.json');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
  console.log('异常：', out.error);
});
