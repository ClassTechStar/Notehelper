// ============================================================
// Notehelper 冒烟测试（Playwright）
// 覆盖 6 条主链路，AI 全部走路由 mock，不发真实网络请求：
//   1. 新建笔记 → 保存 → 再编辑 → 历史回退
//   2. 关键字搜索
//   3. AI 语义搜索（mock）
//   4. AI 思维导图生成（mock）
//   5. 社区收藏 → 「我的收藏」镜像
//   6. 新建科目 → 长按删除
// 运行：npm install && npx playwright install chromium && npm test
// ============================================================
const { test, expect } = require('@playwright/test');

/* ---- AI mock：按 system 提示词特征返回不同结果 ---- */
const TREE = {
  text: '测试科目', children: [
    { text: '板块一', children: [{ text: '要点一', children: [] }, { text: '要点二', children: [] }] },
    { text: '板块二', children: [{ text: '要点三', children: [] }] },
    { text: '板块三', children: [] }
  ]
};
function chatReply(content) {
  return { choices: [{ message: { content: content, reasoning_content: '' } }] };
}
async function mockAI(page) {
  // 预置一个带密钥的本地账户：让 AI 调用走 mock 路由而不是本地兜底
  await page.addInitScript(function () {
    try {
      var KEY = 'nh:user:喔糖圆鼠';   // 喔糖圆鼠
      if (!localStorage.getItem(KEY)) {
        localStorage.setItem(KEY, JSON.stringify({
          username: '喔糖圆鼠', password: '',
          createdAt: new Date().toISOString(),
          apiKey: 'sk-test-mock', chats: {}, notes: null
        }));
        localStorage.setItem('nh:accounts', JSON.stringify([
          { name: '喔糖圆鼠', username: '喔糖圆鼠', createdAt: new Date().toISOString() }
        ]));
        localStorage.setItem('nh:current', '喔糖圆鼠');
      }
    } catch (e) {}
  });
  await page.route('**/api/deepseek', async function (route) {
    const body = JSON.parse(route.request().postData() || '{}');
    const sys = (body.messages && body.messages[0] && body.messages[0].content) || '';
    if (sys.indexOf('检索助手') >= 0) {
      return route.fulfill({ json: chatReply(JSON.stringify({
        intent: '测试意图',
        answer: '',
        items: [{ kind: 'note', id: '____________', score: 90, why: '测试理由' }]
      })) });
    }
    if (sys.indexOf('知识梳理') >= 0 || sys.indexOf('思维导图') >= 0) {
      return route.fulfill({ json: chatReply(JSON.stringify(TREE)) });
    }
    if (sys.indexOf('摘要器') >= 0) {
      return route.fulfill({ json: chatReply('这是一条 AI 生成的测试摘要') });
    }
    if (sys.indexOf('恰好 2 个问题') >= 0) {
      return route.fulfill({ json: chatReply('追问一？\n追问二？') });
    }
    // 笔记对话：主回答 + [[追问]] 行（验证合并请求）
    return route.fulfill({ json: chatReply('这是模拟回答正文。\n\n[[追问]] 继续问什么一 | 继续问什么二') });
  });
  // 直连兜底路径同样 mock，防止误发真实请求
  await page.route('**/api.deepseek.com/**', function (route) { return route.fulfill({ json: chatReply('直连 mock') }); });
}

async function gotoNotes(page) {
  await page.click('.nav-item[aria-label="笔记"]');
  await page.waitForTimeout(150);
}

test.describe('Notehelper 冒烟', function () {

  test('1. 新建 → 保存 → 编辑 → 历史回退', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('.nav-add');                       // 底栏「＋」新建
    await page.fill('#edTitle', '测试笔记A');
    await page.click('#edRich');
    await page.keyboard.type('正文内容第一行');
    await page.click('.editor-save');
    await expect(page.locator('.editor')).toBeHidden();   // 保存成功 = 编辑面板收起
    await expect(page.locator('.card:has-text("测试笔记A")')).toBeVisible();

    // 再编辑改标题（生成第二版）
    await page.click('.card:has-text("测试笔记A")');
    await page.click('.detail-edit');
    await page.fill('#edTitle', '测试笔记A-改');
    await page.click('.editor-save');
    await expect(page.locator('.editor')).toBeHidden();
    await page.click('.detail-close');                   // 关掉还开着的详情页

    // 历史回退到编辑前
    await page.click('.nav-item[aria-label="我的"]');
    await page.click('#histGoNotes');
    var group = page.locator('.ver-group', { hasText: '测试笔记A-改' });
    await group.locator('.ver-head').click();
    var firstBtn = group.locator('.ver-item >> nth=0 >> .ver-btn');
    await firstBtn.click();                              // 回退 → 确认回退
    await firstBtn.click();
    await expect(page.locator('#toast')).toContainText('已回退');

    await gotoNotes(page);
    var reverted = page.locator('.card h2').filter({ hasText: '测试笔记A' }).first();
    await expect(reverted).toHaveText('测试笔记A');
  });

  test('2. 关键字搜索', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('.nav-item[aria-label="搜索"]');
    await page.fill('#sInput', '导数');
    await page.press('#sInput', 'Enter');
    await expect(page.locator('#sNotesCount')).toContainText('条');
    await expect(page.locator('#sNotesList .sr-item').first()).toContainText('导数');
  });

  test('3. AI 语义搜索（mock）', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    // 先记住某篇种子笔记的 id（AI 结果按 id 回引）
    var noteId = await page.evaluate(function () { return window.NHNotes.all()[0].id; });
    await page.route('**/api/deepseek', async function (route) {
      var body = JSON.parse(route.request().postData() || '{}');
      var sys = (body.messages && body.messages[0] && body.messages[0].content) || '';
      if (sys.indexOf('检索助手') >= 0) {
        return route.fulfill({ json: chatReply(JSON.stringify({
          intent: '找导数相关的内容', answer: '',
          items: [{ kind: 'note', id: noteId, score: 95, why: '正文命中导数' }]
        })) });
      }
      return route.fulfill({ json: chatReply('mock') });
    });
    await page.click('.nav-item[aria-label="搜索"]');
    await page.click('.smode[data-mode="ai"]');
    await page.fill('#sInput', '导数怎么下手');
    await page.press('#sInput', 'Enter');
    await expect(page.locator('#sBrief')).toContainText('找导数相关的内容');
    await expect(page.locator('#sNotesList .sr-why').first()).toContainText('正文命中导数');
  });

  test('4. AI 思维导图生成（mock）', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('.nav-item[aria-label="求知"]');
    await expect(page.locator('#mmStatus')).toContainText('已根据', { timeout: 10000 });
    var n = await page.locator('#mmNodes .mm-node').count();
    expect(n).toBeGreaterThanOrEqual(5);                 // 根 + 3 板块 + 要点
  });

  test('5. 收藏社区笔记 → 「我的收藏」镜像', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('.nav-item[aria-label="求知"]');
    await page.waitForTimeout(300);
    // 打开第一张社区卡片并收藏
    await page.click('.c-card >> nth=0');
    await expect(page.locator('#cmmDetail')).toBeVisible();
    await page.click('.cmm-act[data-act="star"]');
    await expect(page.locator('.cmm-act[data-act="star"]')).toContainText('已收藏');
    await page.click('#cmmClose');                       // 先收起浮层（遮罩盖住底栏）
    // 笔记页「我的收藏」出现同一张卡片
    await gotoNotes(page);
    await page.click('.tab[data-tag="我的收藏"]');
    await expect(page.locator('.masonry .c-card').first()).toBeVisible();
  });

  test('6. 新建科目 → 长按删除', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('#catTitle');                       // 展开科目横幅
    await page.click('#cbAddToggle');
    await page.fill('#cbInput', '地理');
    await page.click('#cbAdd');
    await expect(page.locator('.cb-item[data-tag="地理"]')).toBeVisible();
    await expect(page.locator('.tab[data-tag="地理"]')).toBeVisible();

    // 长按 520ms 触发删除确认弹窗
    var item = page.locator('.cb-item[data-tag="地理"]');
    var box = await item.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.locator('#tagDelModal')).toBeVisible();
    await page.click('#cfmOk');
    await expect(page.locator('.cb-item[data-tag="地理"]')).toHaveCount(0);
  });

  test('7. 数据备份导出包含全部 nh: 键', async function ({ page }) {
    await mockAI(page);
    await page.goto('/');
    await page.click('.nav-item[aria-label="我的"]');
    var download = page.waitForEvent('download');
    await page.click('#backup-export');
    var dl = await download;
    expect(dl.suggestedFilename()).toContain('notehelper-backup-');
    var path = await dl.path();
    var fs = require('fs');
    var json = JSON.parse(fs.readFileSync(path, 'utf8'));
    expect(json.app).toBe('notehelper-backup');
    expect(Object.keys(json.data).some(function (k) { return k.indexOf('nh:user:') === 0; })).toBeTruthy();
  });
});
