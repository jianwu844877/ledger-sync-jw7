// Deepcoin 余额同步（稳健版）
// 输出两个口径：
//   total  = 合约权益（含浮动盈亏）+ 资金账户 → 首页「总资产」
//   wallet = 合约钱包余额（不含浮动盈亏）+ 资金账户 → 「钱包余额」
// 重要原则：任何异常都不写 balance.json，直接退出（失败即止，绝不覆盖上一次成功的数据）

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;
const ENC_KEY = (process.env.ENC_KEY || '').trim();

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
  const res = await fetch(BASE + path, { method: 'GET', headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, raw: text };
}

function listOf(json) {
  if (!json) return [];
  const d = json.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  return [];
}

// AES-256-GCM：iv(12) + tag(16) + 密文 的 base64
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
  // 1) 密钥缺失 → 直接失败，不写文件
  if (!KEY || !SECRET || !ENC_KEY) {
    console.error('缺少密钥：DC_KEY / DC_SECRET / ENC_KEY');
    process.exit(1);
  }

  // 2) 合约账户
  const swap = await get('/deepcoin/account/balances?instType=SWAP');
  if (swap.status !== 200) {
    console.error('合约接口失败，status=' + swap.status + ' raw=' + String(swap.raw).slice(0, 200));
    process.exit(1);
  }
  let equitySum = 0, balSum = 0, hasEquity = false;
  for (const it of listOf(swap.json)) {
    const eq = toNum(it.equity);
    const bal = toNum(it.bal);
    if (eq != null) { equitySum += eq; hasEquity = true; }
    if (bal != null) balSum += bal;
  }

  // 3) 资金账户（现货零头）
  const fund = await get('/deepcoin/account/balances');
  if (fund.status !== 200) {
    console.error('资金接口失败，status=' + fund.status + ' raw=' + String(fund.raw).slice(0, 200));
    process.exit(1);
  }
  let fundEquity = 0, fundBal = 0;
  for (const it of listOf(fund.json)) {
    const eq = toNum(it.equity);
    const bal = toNum(it.bal);
    if (eq != null) fundEquity += eq;
    if (bal != null) fundBal += bal;
  }

  const equity = hasEquity ? equitySum : balSum;
  const total = Math.round((equity + fundEquity) * 100) / 100;
  const wallet = Math.round((balSum + fundBal) * 100) / 100;

  // 4) 合理性校验：为 0 或负数一律视为异常，不覆盖上一次成功数据
  if (!(total > 0) || !(wallet >= 0)) {
    console.error('金额异常，拒绝写入：total=' + total + ' wallet=' + wallet);
    process.exit(1);
  }

  const payload = {
    total,
    wallet,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync('balance.json', JSON.stringify({ v: 2, enc: encrypt(payload, ENC_KEY) }, null, 2) + '\n');
  console.log('ok total=' + total + ' wallet=' + wallet);
}

main().catch((e) => {
  // 失败即止：不写 balance.json，让 workflow 以失败收场（GitHub 会发失败通知）
  console.error('同步失败：' + String(e && e.stack ? e.stack : e));
  process.exit(1);
});
