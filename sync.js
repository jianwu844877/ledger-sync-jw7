// Deepcoin 余额同步（正式版 · 加密输出）
// 读合约账户权益（含浮动盈亏），加密后写入 balance.json
// 仓库即使公开，也只能看到一串密文，看不到任何金额

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;
const ENC_KEY = process.env.ENC_KEY || '';

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

// AES-256-GCM 加密：输出 iv(12) + tag(16) + 密文 的 base64
function encrypt(obj, pass) {
  const key = crypto.createHash('sha256').update(String(pass), 'utf8').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

async function main() {
  const updatedAt = new Date().toISOString();
  const payload = { total: 0, currency: 'USD', source: 'deepcoin', updated_at: updatedAt };
if (!KEY || !SECRET || !ENC_KEY) {
    const err = Object.assign({}, payload, { error: '缺少密钥：DC_KEY / DC_SECRET / ENC_KEY' });
    fs.writeFileSync('balance.json', JSON.stringify({ v: 1, enc: encrypt(err, ENC_KEY || 'none') }, null, 2) + '\n');
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
  payload.total = Math.round(total * 100) / 100;

  fs.writeFileSync('balance.json', JSON.stringify({ v: 1, enc: encrypt(payload, ENC_KEY) }, null, 2) + '\n');
  console.log('已加密写入，长度', String(encrypt(payload, ENC_KEY)).length);
}

main().catch((e) => {
  try {
    const err = { total: 0, error: String(e && e.message ? e.message : e), updated_at: new Date().toISOString() };
    fs.writeFileSync('balance.json', JSON.stringify({ v: 1, enc: encrypt(err, process.env.ENC_KEY || 'none') }, null, 2) + '\n');
  } catch (_) {}
});
