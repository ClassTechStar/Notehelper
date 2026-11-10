// 全页面截图（Hallmark redesign 验收用）：node tests/_capture.js <outdir>
const { chromium } = require('@playwright/test');
const path = require('path');
const out = path.resolve(process.argv[2] || '.hallmark/after');
const fs = require('fs');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 402, height: 874 } });
  await page.addInitScript(function () {
    var KEY = 'nh:user:喔糖圆鼠';
    localStorage.setItem(KEY, JSON.stringify({ username: '喔糖圆鼠', password: '', createdAt: 'x', apiKey: 'sk-mock', chats: {}, notes: null }));
    localStorage.setItem('nh:current', '喔糖圆鼠');
  });
  await page.route('**/api/deepseek', function (r) { return r.fulfill({ json: { choices: [{ message: { content: '演示回答' } }] } }); });
  await page.goto('http://localhost:8199/');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'notes.png') });
  await page.click('.nav-item[aria-label="求知"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, 'explore.png') });
  await page.click('.nav-item[aria-label="搜索"]');
  await page.waitForTimeout(400);
  await page.fill('#sInput', '导数');
  await page.press('#sInput', 'Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'search.png') });
  await page.click('.nav-item[aria-label="我的"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'me.png') });
  await page.click('.nav-item[aria-label="笔记"]');
  await page.waitForTimeout(300);
  await page.click('.card >> nth=1');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'detail.png') });
  await b.close();
  console.log('captured to', out);
})();
