# Notehelper · 深度优化任务清单

> 基于仓库现状（2026-09-30）对全部源码（约 1.08 万行：`index.html` 605 行、`app.css` 3017 行、
> `app.js` 3935 行、`explore.js` 2003 行、`user.js` 610 行、`search.js` 620 行）逐一通读后梳理。
> 用途：赛事冲刺排期 + 长期维护路线图。

---

## ✅ 执行状态（2026-09-30 全量执行完毕）

P0~P3 全部 17 项任务已一次性完成（改动仅保存在本地工作区，未提交）。验证情况：

| 任务 | 结果 | 验证方式 |
|------|------|----------|
| T1 仓库化 | ✅ zip 已解包为 `www/`，zip 保留为历史归档 | git 工作区可见全部文件 |
| T2 安卓壳 / server.js / CI | ✅ 全部重建 | **Gradle 8.9 + AGP 8.5.2 真实构建出 APK**；APK 安装到 Pixel 6 模拟器（API 35）启动运行正常；server.js 静态/代理/穿越防护实测通过（含真实上游透传）；workflow 采用同版本组合 |
| T3 视口适配 | ✅ NHZoom 缩放层（CSS zoom，键盘弹出不重算，飞行层坐标换算配套） | 模拟器 411×914dp 实测等比居中渲染正常；宽高比不同的设备两侧留边属预期（填高策略保底栏不被裁） |
| T4 AI 超时中止 | ✅ AbortController + 90s 共享截止时间 | 代码实现 + `node --check`；Playwright 全链路 |
| T5 图片多模态 | ✅ image_url content parts 真传图，历史仍存文字 | Playwright mock 链路 |
| T6 数据备份 | ✅ 导出/导入 UI + `exportAll/importAll` | Playwright「备份导出」用例通过；模拟器截图确认 UI |
| T7 资产瘦身 | ✅ bg.png 2.4MB→jpg 35KB；avatar 1MB→45KB；删 4 张死图 + add.svg（约省 3.4MB） | 全量引用检索 |
| T8 代码去重 | ✅ 删 trimTree/重复 capTotal；esc×5→NHBody.esc；录音→NHRec；图片工具→NHBody | `node --check` + 全量测试 |
| T9 Reveal 触屏降级 | ✅ touch 不做逐帧点灯 | 代码实现 |
| T10 对话历史上限 | ✅ 单篇 60 条 / 60 篇淘汰 | 代码实现 |
| T11 引导问题合并 | ✅ [[追问]] 行随主回答返回，失败回退独立请求 | Playwright mock 验证合并路径 |
| T12 CSP | ✅ meta CSP（self/file/data/blob + DeepSeek + 内联样式） | 模拟器 + Chromium 实测无资源被拦 |
| T13 冒烟测试 | ✅ 7 条用例全过（9s） | `npm test` |
| T14 麦克风接线 | ✅ 点按=录语音附件，录音态高亮 | 代码实现 + UI 截图 |
| T15 a11y | ✅ 允许双指缩放；NHFocus 焦点圈禁接入全部 8 类浮层 | 代码实现 |
| T16 文档对齐 | ✅ README/PROVENANCE 与实际一致 | — |
| T17 演示口径 | ✅ README 注明社区为内置演示数据 | — |

**遗留事项（需要人/真机）**：
1. `git add/commit` 由仓库主人确认后自行执行（本次未做任何提交）；
2. CI workflow（`.github/workflows/build-apk.yml`）需推送后在 GitHub Actions 首跑验证；
3. 推送 GitHub 后在 **Settings → Secrets** 无需额外配置（密钥仍是用户本地填写模式）；
4. 录音 / 相册选择在物理手机上建议再人工过一遍（模拟器已验证基础链路）。

---

## 〇、现状总评

**前端代码完成度很高**：四大页面（笔记 / 求知 / 搜索 / 我的）、块编辑器（图文录音混排）、
思维导图（生成 / 横屏编辑 / 四方向 AI 整理 / 历史回退）、双模搜索（关键字加权 + AI 语义）、
单篇笔记 DeepSeek 对话（附件 / 录音 / 引导追问）、三类历史版本与回退，全部已实现且可运行。
代码注释详尽、风格统一、无障碍标注（aria-*）齐全，localStorage 配额不足有逐级降级，
演示数据有「只替换未动过的旧演示数据」的安全迁移逻辑——工程质量明显高于 typical 参赛作品。

**但仓库现状与代码严重脱节**，且存在若干真实设备上的风险。代码目前只存在于 `Notehelper.zip`
压缩包内，README / PROVENANCE 承诺的 `android/` 壳工程、`server.js` 代理、
`.github/workflows/build-apk.yml` 在仓库中**均不存在**。

---

## 一、任务清单（按优先级）

### P0 · 结构性阻塞项（不解决，后续一切无从谈起）

| # | 任务 | 目标 | 当前进度 | 待完成项 |
|---|------|------|----------|----------|
| T1 | **仓库化：解包 zip 重建 `www/`** | 让源码进入 git 版本管理（可 diff / 审查 / 回滚），zip 只作历史归档 | 未开始 | 解包 `Notehelper.zip` → 提交为 `www/`；决定 zip 的去留；补 `.gitignore` |
| T2 | **找回或重建 `android/` WebView 壳 + `server.js` 代理 + `.github/workflows/build-apk.yml`** | README/PROVENANCE 声称的「APK 自动构建」「本地代理绕 CORS」三件套当前缺位 | 未开始 | 先从旧设备/备份找回；找不回则按 README 描述重建最小壳（WebView 加载 www/、应用名「笔记助理」） |

**依赖**：T1 是所有后续任务的前置（否则改代码 = 改 zip，不可持续）。
T2 依赖 T1（壳工程要打包 www/），并阻塞 T3、T9。

**风险**：赛事评审按 README 第 80 行验证「GitHub Actions 自动出 APK」时直接落空 → **交付物断链，最高风险**。

---

### P1 · 赛事前必须完成（正确性 / 演示效果 / 数据安全）

| # | 任务 | 目标 | 当前进度 | 待完成项 | 依赖 |
|---|------|------|----------|----------|------|
| T3 | **真机适配层** | `.phone` 硬编码 402×874（`app.css:31-42`），无任何媒体查询 / 缩放兜底；README 声称「适配大部分 Android 手机」未经验证 | 未开始 | 加视口缩放兜底（如按 `min(100vw/402, 100vh/874)` 整体 scale，或 WebView 侧设定初始缩放）；在 ≥2 台不同分辨率真机冒烟 | T1、T2 |
| T4 | **AI 请求超时与中止** | `NHAI.post`（`app.js:272`）无 timeout / AbortController；AI 检索、导图生成挂起时 UI 无限转圈（搜索页 `paintLoading` 无退出路径） | 未开始 | fetch 加 AbortController + 30~60s 超时；超时后走既有的 `fallback` / 本地兜底链路 | 无（可并行） |
| T5 | **图片附件升级为真多模态** | `deepseek-flash`（V4.1-Flash）已原生支持视觉输入，但聊天模块仍把图片标注为「当前模型只能处理文本，不必假装读过」（`app.js:3277`），白扔了能力 | 未开始 | 对话消息改用 `content: [{type:'text'},{type:'image_url', image_url:{url: dataURL}}]` 结构传图；录音/文件维持现有降级文案；更新引导语 | 无（可并行） |
| T6 | **数据备份 / 导出入口** | `user.js` 已实现 `exportProfile` / `exportHistory` / `exportMapHistory`，但**全项目无任何 UI 调用**（死能力）；localStorage 被安卓「清除缓存」一冲即空 | 未开始 | 在「我的」页加「导出数据 JSON（下载）/ 导入恢复」两个按钮，复用现有函数；演示机上演练一次 | T1 |
| T7 | **搜索页死资产与首页体积** | `note-history.jpg`(166KB)、`note-math.jpg`(133KB)、`img/history-timeline.jpg`(166KB) 全部**无引用**（约 465KB 死资产）；`bg.png` 2.4MB、`avatar.jpg` 1MB（显示为小头像） | 未开始 | 删除三张无引用图；`bg.png` 压到 <300KB（WebP）、`avatar.jpg` 裁剪压缩到 <50KB | T1 |

**说明**：T5 是「低成本高收益」项——deepseek-flash 的视觉能力让「拍笔记问 AI」成为演示亮点；
T6 是评审现场最怕的「演示机数据丢失」保险。

---

### P2 · 代码质量与性能（赛事后 / 空档期做）

| # | 任务 | 目标 | 当前进度 | 待完成项 |
|---|------|------|----------|----------|
| T8 | **代码去重** | 同一逻辑多处复制，维护易漏改 | 部分识别 | ① `capTotal` 在 `explore.js:159` 与 `explore.js:684` 定义两次（前者被提升覆盖，是死代码）；② `trimTree`（`explore.js:150`）从未被调用；③ `esc`/`escapeHtml` 5 处实现；④ `fileToDataUrl`/`shrink`/`pickMime`/录音启停逻辑在编辑器与聊天模块各写一份 → 抽公共模块（如 `js/common.js`） |
| T9 | **Reveal 光效性能** | `app.js:7-57` 同时监听 `mousemove` + `pointermove`，触屏拖动也触发 rAF 内全量 `querySelectorAll(SEL)` + 每元素 `getBoundingClientRect`，低端 WebView 有掉帧风险 | 未开始 | 触屏（pointerType==='touch'）时降级为静态按压效果或完全跳过；或缓存元素集合仅在 DOM 变化时重建 |
| T10 | **对话历史无限增长** | `persist`（`app.js:3235`）逐条追加无上限，全部存在单一 profile JSON 里，长期使用必然顶到 localStorage 配额 | 未开始 | 设每笔记保留轮数上限 + 全局体积极限，超限提示导出 |
| T11 | **引导问题合并请求** | 每次回答后 `genGuides` 再发一次独立 AI 请求（成本 ×2、延迟 ×2） | 未开始 | 让主回答在 system 里附带输出引导问题（JSON 尾部字段），一次请求返回；失败再退回独立请求 |
| T12 | **CSP 与安全收尾** | `index.html` 无 Content-Security-Policy；正文清洗白名单（`NHBody.clean`）实现良好，但 WebView 场景建议双保险 | 未开始 | 加 CSP meta（`default-src 'self'` + `connect-src` 允许 api.deepseek.com 与本地代理）；核查 WebView `file://` 访问设置 |

---

### P3 · 工程化与体验打磨

| # | 任务 | 目标 | 当前进度 | 待完成项 |
|---|------|------|----------|----------|
| T13 | **冒烟测试** | 全项目零测试 | 未开始 | Playwright 覆盖 6 条主链路：新建→保存→历史回退 / 关键字搜索 / AI 搜索（mock）/ 导图生成（mock）/ 收藏镜像 / 科目增删；无构建步骤，静态页可直接测 |
| T14 | **聊天输入条麦克风接线** | 输入框占位文案「按住提问…」，但左侧麦克风图标（`index.html:339`）**无任何 JS 事件**，纯装饰 → 误导用户 | 未开始 | 接 Web Speech API（WebView 可用性需真机验证）或改为触发「录音附件」，或删图标改文案 |
| T15 | **无障碍收尾** | `user-scalable=no` 禁止缩放（`index.html:6`）；详情 / 编辑 / 导图编辑等模态无焦点圈禁 | 未开始 | 放开缩放限制或提供替代；模态开启时 trap focus、关闭时归还焦点 |
| T16 | **文档对齐** | README 与实际互相矛盾之处需随 T1/T2 一并修正 | 未开始 | README 目录结构、构建说明、`server.js` 代理说明（存在与否、怎么跑）与 PROVENANCE 同步更新 |
| T17 | **演示数据口径** | 「社区」为硬编码 `COMMUNITY` 数组（16 篇，`explore.js:873-975`），搜索 AI 模式会把它当真实社区内容发给模型 | 未开始 | 赛事材料中如实说明为演示数据；若时间允许可做最小可写社区（本地模拟其他用户） |

---

## 二、依赖关系图

```
T1 仓库化 ──┬──> T2 安卓壳/CI ──> T3 真机适配验证 ──> (P1 收尾)
            ├──> T6 导出备份
            ├──> T7 资产瘦身
            └──> T8+ 去重/性能/测试（P2、P3 全部）

T4 超时中止 ──┐
T5 多模态   ──┼── 三者互相独立，可在 T1 完成后并行推进
T7 资产瘦身 ──┘
```

关键路径：**T1 → T2 → T3**。T3 是最后一道闸门（README 的适配承诺只有真机跑过才算数）。

---

## 三、风险登记

| 等级 | 风险 | 影响 | 缓解 |
|------|------|------|------|
| 🔴 高 | APK 构建链路断裂（android/、CI 不在仓库） | 赛事核心交付物缺失 | T2 立即启动，先找回再重建 |
| 🔴 高 | 真机适配未验证（锁定 402×874 无缩放兜底） | 评审手机上溢出/裁切/留边 | T3 缩放兜底 + 双机型冒烟 |
| 🟠 中高 | 数据单点：localStorage 一清即空，无导出 UI | 演示现场数据全丢 | T6 导出/导入按钮（功能已备好） |
| 🟠 中高 | AI 请求无超时，现场网络异常时 UI 永久转圈 | 演示卡死 | T4 AbortController + 兜底链路 |
| 🟠 中 | 配额风险：图片/录音 base64 进 localStorage（虽有哈希去重 + 20 版上限 + sweepMedia），长期累积 | 保存失败提示频出 | T6 导出 + T10 历史上限；中期可迁 IndexedDB |
| 🟡 低 | 浏览器直连 DeepSeek 被 CORS 拦（「测试连接」按钮已如实提示）；代理缺失使 Web 端 AI 不可用 | Web 演示模式 AI 全挂 | T2 重建 server.js 或统一走 WebView 直连验证 |
| 🟡 低 | 社区为硬编码演示数据 | 评审追问「社区怎么运作」 | T17 口径说明 |

---

## 四、建议的后续行动（按周排期）

**第 1 步（立即，半天）**：解包 zip → 重建 `www/` → 提交（T1）。此后所有修改走 git。
**第 2 步（1~2 天）**：找回或重建 android 壳 + server.js + build-apk.yml（T2），跑通一次 Actions 出 APK。
**第 3 步（1 天）**：真机适配兜底 + 两台真机冒烟（T3），同场验证「测试连接」、录音、图片压缩在 WebView 的真实表现。
**第 4 步（1 天）**：导出/导入备份 UI（T6）+ AI 超时中止（T4）。
**第 5 步（1 天）**：多模态图片附件（T5）+ 资产瘦身（T7）——两项都是演示观感直接受益。
**第 6 步（赛事后）**：P2 去重与性能、P3 测试与无障碍、文档对齐。

---

*梳理日期：2026-09-30 · 依据：main 分支 653096f（Add files via upload）解包后的源码全量通读*
