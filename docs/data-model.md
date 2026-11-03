# Cthulhu Table 数据模型

> 版本：v1.0.0 · schemaVersion = 1  
> 所有 JSON Schema 位于 [`schemas/`](../schemas/)，采用 Draft 2020-12。  
> 数据只保存在当前浏览器：轻量数据进 localStorage，模组长文本/聊天/存档进 IndexedDB。

## 1. 设计约定

| 约定 | 说明 |
| --- | --- |
| `id` | 字符串，格式 `pc_*` / `npc_*` / `mod_*` / `chat_*` / `save_*`，由 `storage.js` 生成 |
| `schemaVersion` | 当前为 `1`；以后所有迁移都据此判断 |
| 时间 | ISO 8601 UTC 字符串，例如 `2026-11-02T12:00:00.000Z` |
| 文本转义 | 所有用户/模组文本进入 `innerHTML` 前必须经过 `ui.escapeHTML()` |
| 角色可见性 | PL 与 NPC 共用角色结构，以 `kind: "pc" | "npc"` 区分 |
| 模组隔离 | 未解锁的模组分块不得进入提示词；由 `mustNotLeakBeforeUnlock` 与 KP 状态共同约束 |
| 密钥 | `api.profiles[].apiKey` 只允许存 localStorage；导出备份会包含密钥，界面必须明确警告 |

## 2. 角色卡 `character.schema.json`

完整 Schema：[`../schemas/character.schema.json`](../schemas/character.schema.json)

```text
Character
├── 基本身份：id / kind / name / age / gender / occupation / nationality
├── 外貌：appearance / heightCm / weightKg / personality[] / catchphrase
├── 人设：background / joinReason / importantPerson / ideology
│         significantPlace / treasuredItem / traits / phobias
├── 角色扮演：detailedSetting（支持一万字以上）
├── 语言与物品：motherTongue / languages[] / possessions[]
├── 属性：attributes { str, con, siz, dex, app, int, pow, edu }
├── 幸运：luck
├── 衍生：derived { hp{current,max}, mp{...}, san{...}, mov, db, build }
├── 技能：skills[{ name, base, occupation, interest, total, checked }]
├── 车卡：occupationId / creditRating / occupationPoints / interestPoints / pointsSpent
├── 跨模组记忆：memories[] { campaignId, moduleId, moduleTitle, summary,
│                           keyEvents[], relationships[], unresolved[], createdAt }
└── 元数据：npcDetails? / notes / portrait / createdAt / updatedAt
```

`character.js` 对这份结构执行严格校验：

- 八属性范围 1–99；
- `occupation + interest + base` 与 `total` 一致；
- 职业点、兴趣点分别不超过 `EDU×2`、`INT×2`；
- 职业点仅能用于本职技能（信用评级例外，始终计入职业点）；
- 信用评级落在职业模板给出的区间；
- 年龄修正后再核对 MOV/EDU 等派生值；
- 技能不超过 99（除非规则/模组明确允许）。

### 规则口径（已在 character.js 中实现）

| 项目 | 公式/查表 | 出处 |
| --- | --- | --- |
| 八属性 | STR/CON/DEX/APP/POW = 3D6×5；SIZ/INT/EDU = (2D6+6)×5 | CoC 7e 核心规则书 · 第三章「创建调查员」 |
| 幸运 | 3D6×5；15–19 岁骰两次取高 | 同上 |
| HP | ⌊(CON + SIZ) / 10⌋ | 同上（本项目按用户要求向下取整） |
| MP | ⌊POW / 5⌋ | 同上 |
| SAN | 初始 = POW，上限 99 − 克苏鲁神话技能 | 同上 |
| MOV | STR、DEX 均 < SIZ → 7；任一 ≥ SIZ → 8；两者均 > SIZ → 9；再减年龄修正 | 同上 |
| 技能点 | 职业点 = EDU×2；兴趣点 = INT×2 | 同上 |
| 信用评级 | 必须落在职业模板区间内 | 同上 + 各职业条目 |

DB / Build 查表（STR + SIZ）：

| STR+SIZ | DB | Build |
| --- | --- | --- |
| 2–64 | −2 | −2 |
| 65–84 | −1 | −1 |
| 85–124 | 0 | 0 |
| 125–164 | +1D4 | +1 |
| 165–204 | +1D6 | +2 |
| 205–284 | +2D6 | +3 |
| 285–364 | +3D6 | +4 |
| 365–444 | +4D6 | +5 |
| 445–524 | +5D6 | +6 |

超过 524 后，每再增加 80 点，DB 再 +1D6、Build 再 +1。

年龄修正：

| 年龄 | STR/CON/DEX/APP | EDU | MOV |
| --- | --- | --- | --- |
| 15–19 | −5 | −5 | — |
| 20–39 | — | — | — |
| 40–49 | −5 | +5 | −1 |
| 50–59 | −10 | +10 | −2 |
| 60–69 | −20 | +20 | −3 |
| 70–79 | −40 | +40 | −4 |
| 80+ | −80 | +80 | −5 |

> 上述规则已在 `character.js` 中实现，并通过年龄、MOV、DB/Build、技能点边界测试。

## 3. 模组 `module.schema.json`

完整 Schema：[`../schemas/module.schema.json`](../schemas/module.schema.json)

```text
Module
├── source: txt / md / json / paste + rawText + importedAt
├── structure.chapters[]
│   └── scenes[] { id, title, order, summary, readAloud, content,
│                   clueIds[], npcIds[], eventIds[], isKeyScene }
├── chunks[] { id, chapterId, sceneId, text, keywords[], tokenEstimate,
│              order, mustNotLeakBeforeUnlock }
├── clues[] { id, title, description, sceneId, type, isKey, revealed,
│             revealCondition }
├── npcs[]  { id, name, role, attitude, description, secrets, sceneIds[] }
├── events[] { id, title, mustTrigger, triggerCondition, triggered }
├── retrieval { method: keyword|tfidf|hybrid, index{term: chunkId[]} }
├── aiAudit { verdict, summary, warnings[], keyClues[], mustTriggerEvents[],
│             sceneIssues[], provider, model, checkedAt, truncated }
└── meta { estimatedDuration, playerCount, keeperNotes }
```

关键约束：

1. `chunks` 是检索单位，必须保留原文，不得用 AI 摘要替代。
2. `mustNotLeakBeforeUnlock` 与章节/场景解锁状态共同决定该块能否进入提示词。
3. `mustTrigger` 的事件进入 KP 状态机；触发后写回 `triggered`。
4. `source.rawText` 允许保留完整原文，作为最终事实来源。
5. `aiAudit` 只接受与现有线索/事件/场景标题精确匹配的建议；模型不能凭空新增模组内容。

## 4. 会话/战役 `session.schema.json`

完整 Schema：[`../schemas/session.schema.json`](../schemas/session.schema.json)

```text
Session
├── title / status(setup|active|paused|completed)
├── moduleId + playerCharacterIds[] + npcIds[] + chatIds[]
├── activeChapterId / activeSceneId
├── kpState
│   ├── currentChapterId / currentSceneId
│   ├── visitedSceneIds[]
│   ├── discoveredClueIds[]
│   ├── triggeredEventIds[]
│   ├── npcAttitudes { npcId: { attitude, notes, lastInteraction } }
│   ├── timeline[{ inGameTime, summary }]
│   ├── unlockedContent { chapterIds[], sceneIds[], clueIds[] }
│   ├── flags { key: scalar }
│   └── lastKeeperSummary
└── settings { contextRounds, retrievalTopK, narrativeMin/Max, showInternalState }
```

KP 状态每回合由模型输出结构化增量，再由前端合并；前端是最终状态权威，不直接信任模型重写整份状态。

## 5. 聊天记录 `chat.schema.json`

完整 Schema：[`../schemas/chat.schema.json`](../schemas/chat.schema.json)

```text
Chat
├── campaignId / characterId / sceneId / title
├── messages[]
│   ├── role: user | assistant | system | dice | tool
│   ├── content
│   └── meta { dice, check, model, tokens, durationMs, hidden }
└── createdAt / updatedAt
```

骰子卡片以 `role: "dice"` 存为独立消息，保证之后还能作为上下文传给 KP。暗骰用 `meta.hidden = true` 标记，只在 KP 视图中展示。

## 6. 世界书 `worldbook.schema.json`

完整 Schema：[`../schemas/worldbook.schema.json`](../schemas/worldbook.schema.json)

```text
WorldbookEntry
├── campaignId / moduleId / moduleTitle / sceneId
├── type: log|memory|npc|location|clue|event|note
├── title / content
├── tags[] / characterIds[]
├── source: turn|campaign|manual|memory
├── importance: 0–5
├── includeInContext
└── createdAt / updatedAt
```

写入规则：

1. 每个 KP 回合结束写入 `type: "log"`，内容为玩家行动 + 骰子 + KP 叙事。
2. 模组完结时为每位调查员写入 `type: "memory"`，同时追加到 `Character.memories`。
3. KP 上下文按当前场景/输入关键词 + 角色 id 检索世界书，最多注入 5 条。
4. 世界书不替代模组原文，不允许用未来记录提前泄露本模组未解锁内容。

## 7. 设置 `settings.schema.json`

完整 Schema：[`../schemas/settings.schema.json`](../schemas/settings.schema.json)

```text
Settings
├── app { reduceMotion, lastRoute }
├── api
│   ├── profiles[]
│   │   ├── provider / name / baseUrl / apiKey / model
│   │   ├── temperature / maxTokens / topP / stream
│   │   ├── headersJson / extraBodyJson
│   │   └── webSearch { enabled, headersJson, bodyJson }
│   ├── presets[] { provider, name, baseUrl, apiKey, model }
│   ├── activeProfileId
│   ├── moduleCheckProfileId
│   └── requestTimeoutMs
├── kp { contextRounds, retrievalTopK, narrativeMin/Max, showInternalState }
└── privacy { acknowledgedLocalKey }
```

`headersJson` / `extraBodyJson` 存为**字符串**而不是对象：允许用户编辑到一半时保存，发送前再做严格 JSON 解析并给出中文错误。

`api.presets` 保存可复用的 URL / Key / 模型名；内置服务商只提供 URL 与模型，不包含 Key。`moduleCheckProfileId` 指向用于模组导入审计的接口配置，推荐 DeepSeek：
`https://api.deepseek.com/v1` + `deepseek-chat`。AI 审计结果写入 `module.aiAudit`，不会覆盖原文。

`/models` 的检测结果不写入 Settings；前端在 `model-catalog.js` 中按提供商分组，并用参考价格目录（USD / 1M tokens）在组内升序展示。价格可能过时，只作为模型选择参考。

## 8. localStorage 键位

| 键 | 内容 |
| --- | --- |
| `cthulhu-table:settings:v1` | `Settings` |
| `cthulhu-table:characters:v1` | `{ schemaVersion, items: { [id]: Character } }` |
| `cthulhu-table:campaigns:v1` | `{ schemaVersion, items: { [id]: Session } }` |
| `cthulhu-table:active-campaign:v1` | 当前战役 id |
| `cthulhu-table:ui:v1` | 预留：滚动位置、折叠状态等纯界面偏好 |

## 9. IndexedDB 对象仓库

数据库：`cthulhu-table` · 版本 `2`（v2 新增 `worldbook` 仓库）

| store | keyPath | 索引 | 内容 |
| --- | --- | --- | --- |
| `modules` | `id` | `updatedAt` | 模组全文、结构树、分块、线索、事件 |
| `chats` | `id` | `campaignId`, `updatedAt` | 聊天记录 |
| `saves` | `id` | `campaignId`, `createdAt` | 战役快照 |
| `worldbook` | `id` | `campaignId`, `type`, `updatedAt` | 跑团日志、角色记忆、NPC/地点/线索/笔记 |
| `apiLogs` | `id` | `createdAt` | 请求耗时、Token、错误摘要 |
| `meta` | `key` | — | 数据库版本、自检探针、迁移标记 |

## 10. 导出格式

角色 JSON：

```json
{
  "format": "cthulhu-table.character",
  "version": 1,
  "exportedAt": "2026-11-02T12:00:00.000Z",
  "character": {}
}
```

完整备份：

```json
{
  "format": "cthulhu-table.backup",
  "version": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-11-02T12:00:00.000Z",
  "settings": {},
  "characters": [],
  "campaigns": [],
  "activeCampaignId": "",
  "modules": [],
  "chats": [],
  "saves": [],
  "worldbook": []
}
```

单战役导出格式为 `cthulhu-table.campaign`，包含 `campaign`、`module`、`characters`、`chats`、`saves` 与 `worldbook`。

> 完整备份包含 API 配置和密钥。导入备份会覆盖当前浏览器数据，UI 会二次确认。
