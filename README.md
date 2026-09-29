# Notehelper 笔记助理

> 面向「教育」场景的 AI 学习工具 —— 把零散笔记变成可检索、可对话、可生成思维导图的结构化知识。
> 参赛项目：**[2026年第二届重庆市AI大模型创新应用大赛](https://www.cqoec.cn/)** · **AI创意赛道** · 教育行业场景升级

---

## 一、赛事背景

为深入落实科教兴国、人才强国、创新驱动发展战略，主动适应重庆市"416"科技创新布局和
"33618"现代制造业集群体系建设需要，培育 AI 领域拔尖创新人才与复合型应用人才，由
**重庆市教育委员会**主办、**重庆邮电大学**承办的"2026年第二届重庆市AI大模型创新应用大赛"已正式启动。

本作品参加 **AI创意赛道**：基于主流 AI 大模型（DeepSeek、豆包、文心一言、Kimi、讯飞星火、
腾讯混元、智谱清言等），完成教育、医疗、政务、金融、制造等行业场景应用升级的产品展示与
可落地解决方案。Notehelper 选择 **教育** 场景，以 **DeepSeek 大模型** 为底座，
解决学生"笔记散、难回顾、不知道漏了什么"的复习痛点。

## 二、作品定位与痛点

| 痛点 | Notehelper 的解法 |
|------|-------------------|
| 笔记零散、复习无头绪 | 按"科目"归类的结构化笔记 + AI 思维导图总览 |
| 传统搜索只能关键字匹配，问不出"意图" | 内置 **AI 语义检索**，理解问题与意图 |
| 复习时不知道自己"漏了什么" | 导图「AI 整理 · 查漏补缺」对照笔记补盲区 |
| 问 AI 要反复粘贴上下文 | 笔记详情内 **DeepSeek 对话**直接基于该篇笔记问答 |

## 三、功能一览

界面适配大部分Android手机，分为一下多个板块。

### 笔记（主页）
- 瀑布流卡片展示个人笔记。
- **笔记编辑器**：段落与图片 / 文档 / 录音混排（类 Word），支持加粗、斜体、下划线、行内代码、
  引用、项目符号、编号列表、清除格式。
- 摘要可使用**Deepseek 依据正文总结**；手填内容 AI 不覆盖。

### 求知（AI 思维导图 + 社区）
- 依据**同科目笔记**，由 AI 生成思维导图，像地图一样可缩放 / 平移。
- **横屏编辑**（模拟横屏，不旋转设备）：增删节点、引用社区笔记到节点、"**AI 整理**"
  （四个方向：精简主干 / 展开细节 / 按考点重组 / 查漏补缺 + 自由发挥输入）。
- 可回退到任意历史导图版本。
- 下半屏为**社区推荐流**，让用户的学习灵感相互碰撞。
  > 说明：社区内容为**内置演示数据**（`explore.js` 中的 16 篇示例笔记），
  > 用于展示「社区笔记 ↔ 导图节点引用」的完整交互；正式版可替换为真实后端。

### 搜索
- 两种路径：**关键字**即时匹配 + **AI 智能**语义检索。
- 结果分「本地笔记 / 社区内容」两区，各自带命中计数；AI 还会给出意图总览与直接回答。

### 我的 / 历史记录
- DeepSeek API 密钥设置（仅存本地 `localStorage`，**不上传**）。
- 三类历史：笔记版本 / 对话历史 / 思维导图版本，均可回退（回退前自动留档，操作可逆）。
- **数据备份**：一键导出全部本地数据为 JSON、导入恢复（换机 / 清缓存前留档）。

### 笔记详情 + DeepSeek 对话
- 米黄"纸面"阅读体验（标题 + 日期 + 正文）。
- 底部居中「DeepSeek 对话」浮层：针对该篇笔记提问、首答后出现引导追问、可挂附件
  （录音 / 图片 / 文件）；图片附件以**多模态**方式真传给视觉模型。

## 四、技术架构

```
┌─────────────────────────────────────────────┐
│  前端（纯静态，零打包 / 零 CDN 依赖）          │
│  www/  index.html + css/app.css               │
│         js/user.js app.js explore.js search.js│
│         icons/(20 SVG)  img/                  │
└───────────────┬───────────────────────────────┘
                │  WebView 加载（安卓壳）
                │  或 node server.js 静态托管（本地开发）
┌───────────────┴───────────────────────────────┐
│  server.js（可选本地代理 /api/deepseek，绕 CORS）│
└───────────────┬───────────────────────────────┘
                │  fetch（代理优先，失败自动回退直连）
┌───────────────┴───────────────────────────────┐
│  DeepSeek Chat Completions API（用户自备 Key）  │
└───────────────────────────────────────────────┘
```

- **前端**：原生 HTML/CSS/JS，无框架、无构建步骤，可直接 `file://` 或静态服务打开；
  视口按窗口整体等比缩放（402×874 基准），适配不同分辨率的手机。
- **AI 后端**：DeepSeek API（`https://api.deepseek.com/chat/completions`，模型
  `deepseek-flash`），密钥本地保存；所有 AI 请求带 90s 超时与兜底链路。
- **安卓壳**：`android/` 标准 WebView 工程（零第三方 SDK），构建时由 `syncWww`
  任务把 `www/` 同步进 assets。
- **本地服务器**：`server.js`（Node ≥ 18，零依赖）——静态托管 + AI 代理。
- **构建发布**：GitHub Actions（`.github/workflows/build-apk.yml`）自动出 APK，产物在 Actions Artifact。
- **冒烟测试**：Playwright（`tests/`，AI 全 mock），`npm test` 运行。

## 五、目录结构

```
Notehelper/
├── www/                  # Web 源码（安卓构建时由 syncWww 同步进 assets）
│   ├── index.html        # 四个主页面 + 三个子页 + 各浮层
│   ├── css/app.css
│   ├── js/{user,app,explore,search}.js
│   ├── icons/            # 20 个 Iconsax 图标（见 PROVENANCE）
│   ├── img/              # 示例图
│   └── userdata/         # 运行时用户数据（版本库 / 历史）
├── android/              # WebView 壳工程（应用名"笔记助理"，零第三方 SDK）
├── server.js             # 本地开发/演示服务器：静态托管 + /api/deepseek 代理
├── tests/                # Playwright 冒烟测试（AI 全 mock）
├── playwright.config.js
├── Notehelper.zip        # 2026-09 上传的历史归档（源码已解包为 www/，以此为准）
├── .github/workflows/    # APK 自动构建
├── OPTIMIZATION_TASKS.md # 深度优化任务清单（进度跟踪）
├── LICENSE               # MIT License
├── PROVENANCE            # 第三方资源与来源说明
└── README.md
```

## 六、本地运行

**Web**
```bash
# 方式一：本地服务器（推荐，自带 /api/deepseek 代理，AI 功能不受 CORS 限制）
node server.js          # Node ≥ 18，打开 http://localhost:8080

# 方式二：任意静态服务
cd www && python -m http.server 8000
```
AI 功能需在「我的」页填入 DeepSeek API Key（仅存本机）。

**安卓**
用 Android Studio 打开 `android/`（首次构建自动把 `www/` 同步进 assets），
或推送后由 GitHub Actions 构建 APK，在 Actions Artifact 下载。

**冒烟测试**
```bash
npm install && npx playwright install chromium && npm test
```

## 七、第三方资源与许可

- 界面图标来自 **Iconsax** 免费图标集，AI 能力来自 **DeepSeek** 官方 API，
  交互灵感借鉴 **Memorization UI（UWP Reveal）**——详见 [PROVENANCE](./PROVENANCE)。
- 本仓库**不含任何预编译二进制或闭源组件**，前端代码均为团队原创。

## 八、许可

[MIT License](./LICENSE) © 2026 Notehelper 团队。

## 九、参赛信息

- **赛事**：2026年第二届重庆市AI大模型创新应用大赛
- **主办**：重庆市教育委员会　**承办**：重庆邮电大学
- **赛道**：AI创意赛道
- **方向**：教育行业场景升级（基于 DeepSeek 大模型）
- **作品**：Notehelper 笔记助理

---

*最后更新：2026-09-30*
