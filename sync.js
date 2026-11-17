name: sync-balance

on:
  schedule:
    # 每 2 小时跑一次（GitHub 的定时任务可能延迟几分钟到半小时，属正常）
    - cron: "0 */2 * * *"
  workflow_dispatch:   # 也可以在网页上手动点一下立即运行

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: 读取余额
        env:
          DC_KEY: ${{ secrets.DC_KEY }}
          DC_SECRET: ${{ secrets.DC_SECRET }}
          DC_PASS: ${{ secrets.DC_PASS }}
          ENC_KEY: ${{ secrets.ENC_KEY }}
          DC_BASE: https://api.deepcoin.com
        run: node sync.js

      - name: 提交 balance.json
        run: |
          git config user.name "balance-bot"
          git config user.email "balance-bot@users.noreply.github.com"
          git add balance.json
          git commit -m "update balance $(date -u +%Y-%m-%dT%H:%M:%SZ)" || echo "无变化"
          git push
