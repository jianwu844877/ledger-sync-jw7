// Deepcoin 余额读取脚本 v4（在 GitHub Actions 里运行）—— 定稿版
// 接口：GET https://api.deepcoin.com/deepcoin/account/balances（已实测 200）
// 返回结构：{ code, msg, data: [ { ccy, bal, frozenBal, availBal, unrealizedProfit, equity } ] }
// 总资产口径：各币种 equity（按 USD 折算）求和；若 equity 全为 0，则退回用 bal 求和

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

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

async function main() {
  const out = {
    total: null,
    currency: 'USD',
    source: 'deepcoin',
    updated_at: new Date().toISOString(),
    path_used: PATH,
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
  try { json = JSON.parse(text); } catch (e) {
    out.error = '返回不是 JSON';
  }

  if (json) {
    if (String(json.code) !== '0' && json.code != null) {
out.error = '交易所返回错误码 ' + json.code + ' ' + (json.msg || '');
    }
    const list = Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);

    let byEquity = 0, byBal = 0, hit = false;
    for (const it of list) {
      if (!it || typeof it !== 'object') continue;
      const eq = toNum(it.equity);
      const bal = toNum(it.bal);
      if (eq != null) { byEquity += eq; hit = true; }
      if (bal != null) byBal += bal;
    }
    if (hit) {
      out.total = Math.round((byEquity > 0 ? byEquity : byBal) * 100) / 100;
      out.coin_count = list.length;
    } else {
      out.error = out.error || '未识别出余额字段';
    }
  }

  fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n');
  console.log('总资产：', out.total, out.error ? ('/ ' + out.error) : '');
}

main().catch((e) => {
  const out = { total: null, error: String(e && e.message ? e.message : e) };
  try { fs.writeFileSync('balance.json', JSON.stringify(out, null, 2) + '\n'); } catch (_) {}
  console.log('异常：', out.error);
});
