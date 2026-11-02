# Cthulhu Table

> 纯前端、零构建、本地优先的《克苏鲁的呼唤》第七版 AI 跑团桌面。  
> 单人 / 多 PL · AI 守秘人 · GitHub Pages 静态托管 · 同人作品

当前版本：**v0.1.0 · 第一阶段（应用外壳、页面骨架与本地数据层）**

![Cthulhu Table 首屏](docs/preview-home.webp)

---

## 快速开始

### 方式一：本地预览（推荐）

双击项目根目录的 **`启动本地预览.bat`**，浏览器会自动打开：

```text
http://127.0.0.1:8000/
```

脚本只使用 Windows 自带的 PowerShell，启动一个只读静态文件服务器，不需要 Node、Python 或任何后端。

### 方式二：任意静态服务器

```powershell
# 例如使用 Python
python -m http.server 8000
# 或使用 VS Code 的 Live Server
```

然后访问 `http://127.0.0.1:8000/`。

### 为什么不能直接双击 `index.html`？

项目使用**原生 ES Module**。浏览器安全策略禁止 `file://` 页面通过 CORS 加载模块文件，因此直接双击 `index.html` 会卡在启动页。这里没有改用打包器或全局变量，而是：

- 本地：使用 `启动本地预览.bat` / `serve.ps1`；
- 线上：GitHub Pages 通过 HTTPS 提供静态文件，不存在该限制。

这保持了「无构建链 + 原生 ES Module」的技术约束，也不引入任何后端。

### 部署到 GitHub Pages

1. 将整个 `cthulhu-table` 目录内容推到仓库根目录（或任意子目录）。
2. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`。
3. 等待发布。`.nojekyll` 已包含，避免 Jekyll 干扰静态资源。
4. 所有路由为 Hash 路由（`#/home`），不需要 404 重写规则。

---

## 第一阶段已实现

- [x] 暗黑克苏鲁视觉系统：深墨绿、旧金、暗红、羊皮纸纹理、响应式布局
- [x] 六个页面的 Hash 路由骨架：总览 / 调查员 / 车卡工坊 / 模组档案 / 跑团桌面 / 设置
- [x] 移动端侧栏、遮罩、断点适配与减少动效开关
- [x] 自定义 SVG 印记、图标 sprite、空状态、Toast、原生 `<dialog>` 弹窗
- [x] `storage.js` 本地数据层：localStorage + IndexedDB + 内存降级 + 自检
- [x] 角色卡基础校验、示例调查员载入、完整档案预览、JSON 导出、删除
- [x] 完整备份导出（设置 / 角色 / 模组 / 聊天 / 存档）
- [x] 五份核心 JSON Schema + 数据模型文档
- [x] 中文注释、无 TODO 占位、无外部 CDN/字体依赖

### 尚未接入（按阶段交付）

| 阶段 | 内容 |
| --- | --- |
| 2 | 角色编辑、CoC 7e 规则引擎、职业模板、随机/手动车卡、JSON/Markdown 导入导出 |
| 3 | 多套 OpenAI 兼容接口、SSE 流式、自定义请求头/请求体、联网开关、AI 自动车卡、日志 |
| 4 | 骰子表达式、奖励/惩罚骰、CoC 检定、SAN/疯狂/伤害、聊天卡片 |
| 5 | 模组导入解析、结构树编辑、TF-IDF 检索、KP 状态、严格模组提示词 |
| 6 | 整战役存档/读档、聊天分组、日志面板、移动端回归、发布检查 |

> 第一阶段页面中涉及后续阶段的功能，会明确打开「路线图」说明，不使用静态假按钮或伪造数据。

---

## 文件树与职责

```text
cthulhu-table/
├── index.html                  应用外壳、SEO/主题色、启动页、图标 sprite、dialog/toast 容器
├── css/
│   └── main.css                设计令牌、布局、全部组件、响应式、动效与可访问性样式
├── js/
│   ├── app.js                  Hash 路由、六个页面模板、首屏交互、全局事件、启动流程
│   ├── storage.js              localStorage/IndexedDB 封装、设置/角色/模组/聊天/存档 API、自检、备份
│   ├── ui.js                   HTML 转义、图标、时间/字节格式化、Toast、dialog、下载工具
│   └── sample-data.js          两位完整示例调查员（仅点击载入时写入本地）
├── assets/
│   └── sigil.svg               原创旧日印记 SVG（Logo / 空状态 / 首屏）
├── schemas/
│   ├── character.schema.json   PL / NPC 角色卡 JSON Schema
│   ├── module.schema.json      模组结构树、分块、线索、NPC、事件 Schema
│   ├── session.schema.json     战役会话与 KP 内部状态 Schema
│   ├── settings.schema.json    应用设置与多套 API 配置 Schema
│   └── chat.schema.json        聊天记录与骰子消息 Schema
├── docs/
│   ├── data-model.md           数据模型说明、字段树、规则口径、存储键位
│   └── roadmap.md              六阶段任务清单与每阶段验收标准
├── serve.ps1                   零依赖 PowerShell 静态预览服务器
├── 启动本地预览.bat            双击启动本地预览
├── .nojekyll                   GitHub Pages 禁用 Jekyll 处理
└── README.md                   本文件
```

后续阶段会新增：

```text
js/
├── character.js                车卡规则、年龄修正、职业模板、技能点校验、Markdown 导出
├── dice.js                     骰子表达式解析、奖惩骰、CoC 检定、SAN/伤害
├── api.js                      OpenAI Chat Completions、SSE、请求头/体合并、日志
├── module.js                   模组解析、结构树、倒排索引/TF-IDF 检索
└── kp.js                       KP 提示词、状态机、上下文组装、信息释放控制
```

---

## 数据与隐私

- **没有后端。** 没有统计、没有账号、没有云端同步。
- 设置与角色卡存 `localStorage`；模组原文、聊天、存档、API 日志存 `IndexedDB`。
- API Key 只存在当前浏览器的 `localStorage`，并通过前端 `fetch` 直连你填写的接口。
- 完整备份 JSON **包含 API Key**；不要把备份提交到公开仓库。
- 清除浏览器站点数据会丢失全部战役；请定期导出备份。

---

## 规则与版权

- 规则口径：*Call of Cthulhu 7th Edition* 核心规则书。
- 车卡公式、年龄修正、DB/Build 表、检定等级会在对应阶段以中文注释写入代码，并标注出处。
- 本工具为非官方同人作品，与 Chaosium Inc. 无隶属关系。
- 请只导入你拥有使用权的模组文本。
