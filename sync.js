// Deepcoin 余额读取脚本（在 GitHub Actions 里运行）
// 作用：用只读 API Key 签名请求交易所，把总资产写进 balance.json

const crypto = require('crypto');
const fs = require('fs');

const BASE = (process.env.DC_BASE || 'https://api.deepcoin.com').replace(/\/+$/, '');
const PATH = process.env.DC_PATH || '/deepcoin/account/balance';

const KEY = process.env.DC_KEY;
const SECRET = process.env.DC_SECRET;
const PASS = process.env.DC_PASS;

if (!KEY || !SECRET) {
  console.error('缺少 DC_KEY / DC_SECRET，请检查仓库 Secrets 配置');
  process.exit(1);
}

// 文档要求：时间戳用 ISO 格式，例如 2020-12-08T09:08:57.715Z
const ts = new Date().toISOString();

// 签名 = base64( HMAC-SHA256( secret, timestamp + method + requestPath + body ) )
const message = ts + 'GET' + PATH + '';
const sign = crypto.createHmac('sha256', SECRET).update(message).digest('base64');

const headers = {
  'DC-ACCESS-KEY': KEY,
  'DC-ACCESS-SIGN': sign,
  'DC-ACCESS-TIMESTAMP': ts,
  'DC-ACCESS-PASSPHRASE': PASS || '',
  'Content-Type': 'application/json',
};

console.log('请求', BASE + PATH);

(async () => {
  let res, text;
  try {
    res = await fetch(BASE + PATH, { method: 'GET', headers });
    text = await res.text();
  } catch (e) {
    console.error('网络请求失败：', e.name, e.message);
    process.exit(2);
  }

  console.log('HTTP', res.status);

  // 注意：仓库是公开的，运行日志也会公开。失败时只打印少量片段用于排错，
  // 成功时不打印返回内容，避免把持仓明细暴露在公开日志里。
  if (res.status !== 200) {
    console.log('返回片段：', text.slice(0, 120));
  }

  let json = null;
  try { json = JSON.parse(text); } catch (e) {}

  // ---- 解析总资产：从常见字段里找一个 USD 口径的数值 ----
  const EQ = ['totalEq', 'totalEquity', 'equity', 'totalUsd', 'usdValue',
              'totalBalanceValue', 'netEquity', 'totalAsset', 'totalBalance', 'balance', 'eq'];
  const STABLE = ['USDT', 'USDC', 'USD', 'DAI', 'TUSD', 'FDUSD'];

  function pick(obj) {
    for (const k of EQ) {
      if (obj[k] != null && !isNaN(Number(obj[k]))) return Number(obj[k]);
    }
    return null;
  }

  let total = null;
  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;

  if (Array.isArray(data)) {
    let sum = 0, hit = false;
    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      let v = pick(it);
      if (v == null) {
        const ccy = String(it.ccy || it.currency || it.coin || it.symbol || '').toUpperCase();
        if (STABLE.includes(ccy)) {
          const cand = it.cashBal != null ? it.cashBal : (it.bal != null ? it.bal : it.availBal);
          if (cand != null && !isNaN(Number(cand))) v = Number(cand);
        }
      }
      if (v != null) { sum += v; hit = true; }
    }
    if (hit) total = sum;
  } else if (data && typeof data === 'object') {
    total = pick(data);
  }

  if (total == null) {
    console.error('没有识别出余额字段，原始返回见上方');
    process.exit(3);
  }

  const out = {
    total: Math.round(total * 100) / 100,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    http_status: res.status,
  };

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 balance.json：', JSON.stringify(out));
})();
//（注：内容由AI生成）
