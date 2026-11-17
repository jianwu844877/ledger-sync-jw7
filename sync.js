// Deepcoin 余额读取脚本 v2（在 GitHub Actions 里运行）
// 作用：用只读 API Key 签名请求交易所，把总资产写进 balance.json
// v2：自动遍历多个候选路径，找出真正存在的余额接口；失败也写文件，方便排查

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

// 候选路径：按可能性排序，第一个返回有效余额的就采用
const CANDIDATES = [
  '/deepcoin/account/balance',
  '/deepcoin/account/balances',
  '/deepcoin/account/assets',
  '/deepcoin/account/asset',
  '/deepcoin/account/info',
  '/deepcoin/asset/balance',
  '/deepcoin/api/v1/account/balance',
  '/api/v1/account/balance',
  '/deepcoin/v1/account/balance',
  '/deepcoin/account/spot/balance',
  '/deepcoin/account/funding/balance',
  '/account/balance',
];

function sign(secret, ts, path) {
  return crypto.createHmac('sha256', secret).update(ts + 'GET' + path + '').digest('base64');
}

// 从返回里提取总资产（USD 口径）
const EQ = ['totalEq', 'totalEquity', 'equity', 'totalUsd', 'usdValue',
'totalBalanceValue', 'netEquity', 'totalAsset', 'totalBalance', 'balance', 'eq'];
const STABLE = ['USDT', 'USDC', 'USD', 'DAI', 'TUSD', 'FDUSD'];

function pick(obj) {
  for (const k of EQ) {
    if (obj[k] != null && !isNaN(Number(obj[k]))) return Number(obj[k]);
  }
  return null;
}

function extract(json) {
  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
  if (Array.isArray(data)) {
    let sum = 0, hit = false;
    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      let v = pick(it);
      if (v == null) {
        const ccy = String(it.ccy || it.currency || it.coin || it.symbol || '').toUpperCase();
        if (STABLE.includes(ccy)) {
          const c = it.cashBal != null ? it.cashBal : (it.bal != null ? it.bal : it.availBal);
          if (c != null && !isNaN(Number(c))) v = Number(c);
        }
      }
      if (v != null) { sum += v; hit = true; }
    }
    if (hit) return sum;
  } else if (data && typeof data === 'object') {
return pick(data);
  }
  return null;
}

async function main() {
  const out = {
    total: null,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    path_used: null,
    attempts: [],
  };

  if (!KEY || !SECRET) {
    out.error = '缺少 DC_KEY 或 DC_SECRET';
    fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
    console.log(out.error);
    return;
  }

  for (const path of CANDIDATES) {
    const ts = new Date().toISOString();
    const headers = {
      'DC-ACCESS-KEY': KEY,
      'DC-ACCESS-SIGN': sign(SECRET, ts, path),
      'DC-ACCESS-TIMESTAMP': ts,
      'DC-ACCESS-PASSPHRASE': PASS || '',
      'Content-Type': 'application/json',
    };

    let status = 0, text = '';
    try {
      const res = await fetch(BASE + path, { method: 'GET', headers });
      status = res.status;
      text = await res.text();
    } catch (e) {
      out.attempts.push({ path, status: 0, note: '网络失败:' + e.message });
      console.log(path, '-> 网络失败', e.message);
      continue;
    }

    let note = '';
    if (status !== 200) note = text.slice(0, 80).replace(/\s+/g, ' ');
    out.attempts.push({ path, status, note });
    console.log(path, '->', status, note);

    if (status === 200) {
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      const total = json ? extract(json) : null;
      if (total != null) {
        out.total = Math.round(total * 100) / 100;
        out.path_used = path;
        out.http_status = status;
        break;
      } else {
        out.attempts[out.attempts.length - 1].note = '200 但未识别出余额字段';
      }
    }
  }

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 balance.json');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
  console.log('异常：', out.error);
});
