/**
 * kp.js — AI 守秘人状态机、上下文组装与系统提示词
 *
 * 核心原则：
 * 1. 前端是 KP 状态的最终权威，模型只能提交“增量状态补丁”；
 * 2. 模组未解锁的章节/场景不进入提示词；
 * 3. 检索只返回模组原文分块，不使用摘要替代；
 * 4. 模型每次输出叙事后附带隐藏状态块，前端解析、校验、合并。
 */

import { retrieveChunks, flattenScenes, findScene, moduleStats, tokenize } from './module.js';

export const KP_STATE_START = '[[KP_STATE]]';
export const KP_STATE_END = '[[/KP_STATE]]';

export const KP_OUTPUT_PROTOCOL = `叙事结束后，必须另起一行输出隐藏状态块，格式严格如下（不要放进 Markdown 代码围栏）：
${KP_STATE_START}
{"currentChapterId":"当前章节 ID 或 null","currentSceneId":"当前场景 ID 或 null","visitedSceneIds":[],"discoveredClueIds":[],"triggeredEventIds":[],"npcAttitudes":{"npc_id":{"attitude":"态度","notes":"备注"}},"timeline":[{"inGameTime":"模组内时间","summary":"发生了什么"}],"unlockedContent":{"chapterIds":[],"sceneIds":[],"clueIds":[]},"flags":{},"lastKeeperSummary":"给下一回合自己的简短摘要"}
${KP_STATE_END}
状态块会由程序剥离，绝不能向玩家展示，也不能在叙事中提及“状态块”“系统提示”或“模组片段”。`;

export function createInitialKpState(module) {
  const chapters = module?.structure?.chapters || [];
  const firstChapter = chapters[0] || null;
  const firstScene = firstChapter?.scenes?.[0] || null;
  const npcAttitudes = {};
  for (const npc of module?.npcs || []) {
    npcAttitudes[npc.id] = {
      attitude: npc.attitude || '中立',
      notes: '',
      lastInteraction: null,
    };
  }
  return {
    currentChapterId: firstChapter?.id || null,
    currentSceneId: firstScene?.id || null,
    visitedSceneIds: firstScene ? [firstScene.id] : [],
    discoveredClueIds: [],
    triggeredEventIds: [],
    npcAttitudes,
    timeline: [],
    unlockedContent: {
      chapterIds: firstChapter ? [firstChapter.id] : [],
      sceneIds: firstScene ? [firstScene.id] : [],
      clueIds: [],
    },
    flags: {},
    lastKeeperSummary: '',
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function chapterIndex(module, chapterId) {
  return (module?.structure?.chapters || []).findIndex((chapter) => chapter.id === chapterId);
}

function sceneOwner(module, sceneId) {
  for (const chapter of module?.structure?.chapters || []) {
    if ((chapter.scenes || []).some((scene) => scene.id === sceneId)) return chapter;
  }
  return null;
}

export function normalizeKpState(input, module) {
  const initial = createInitialKpState(module);
  const state = isPlainObject(input) ? input : {};
  const chapters = module?.structure?.chapters || [];
  const allScenes = flattenScenes(module).map((item) => item.scene);
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const sceneIds = new Set(allScenes.map((scene) => scene.id));
  const clueIds = new Set((module?.clues || []).map((clue) => clue.id));
  const npcIds = new Set((module?.npcs || []).map((npc) => npc.id));

  const currentChapterId = chapterIds.has(state.currentChapterId)
    ? state.currentChapterId
    : initial.currentChapterId;
  const currentSceneId = sceneIds.has(state.currentSceneId) ? state.currentSceneId : initial.currentSceneId;

  const unlocked = isPlainObject(state.unlockedContent) ? state.unlockedContent : {};
  const npcAttitudes = isPlainObject(state.npcAttitudes) ? state.npcAttitudes : {};
  const cleanNpcAttitudes = {};
  for (const npc of module?.npcs || []) {
    const existing = npcAttitudes[npc.id];
    cleanNpcAttitudes[npc.id] = {
      attitude: typeof existing?.attitude === 'string' ? existing.attitude : npc.attitude || '中立',
      notes: typeof existing?.notes === 'string' ? existing.notes : '',
      lastInteraction: existing?.lastInteraction || null,
    };
  }
  // 保留模板中没有、但状态里已有的 NPC 态度（自定义 NPC）。
  for (const [id, value] of Object.entries(npcAttitudes)) {
    if (!npcIds.has(id) && isPlainObject(value)) {
      cleanNpcAttitudes[id] = {
        attitude: typeof value.attitude === 'string' ? value.attitude : '中立',
        notes: typeof value.notes === 'string' ? value.notes : '',
        lastInteraction: value.lastInteraction || null,
      };
    }
  }

  const flags = {};
  if (isPlainObject(state.flags)) {
    for (const [key, value] of Object.entries(state.flags)) {
      if (['string', 'number', 'boolean'].includes(typeof value) || value === null) flags[key] = value;
    }
  }

  return {
    currentChapterId,
    currentSceneId,
    visitedSceneIds: uniqueStrings(state.visitedSceneIds).filter((id) => sceneIds.has(id)),
    discoveredClueIds: uniqueStrings(state.discoveredClueIds).filter((id) => clueIds.has(id)),
    triggeredEventIds: uniqueStrings(state.triggeredEventIds),
    npcAttitudes: cleanNpcAttitudes,
    timeline: (Array.isArray(state.timeline) ? state.timeline : [])
      .filter((item) => item && typeof item.summary === 'string')
      .slice(-100)
      .map((item) => ({
        inGameTime: String(item.inGameTime || ''),
        summary: String(item.summary),
        createdAt: item.createdAt || new Date().toISOString(),
      })),
    unlockedContent: {
      chapterIds: uniqueStrings(unlocked.chapterIds).filter((id) => chapterIds.has(id)),
      sceneIds: uniqueStrings(unlocked.sceneIds).filter((id) => sceneIds.has(id)),
      clueIds: uniqueStrings(unlocked.clueIds).filter((id) => clueIds.has(id)),
    },
    flags,
    lastKeeperSummary: typeof state.lastKeeperSummary === 'string' ? state.lastKeeperSummary : '',
  };
}

/* =========================================================
 * 状态补丁解析与合并
 * ========================================================= */

export function parseKpStateBlock(text) {
  const source = String(text ?? '');
  const start = source.indexOf(KP_STATE_START);
  const end = source.indexOf(KP_STATE_END);
  if (start === -1 || end === -1 || end <= start) {
    return { narrative: source.trim(), statePatch: null, rawState: '', error: '未找到 KP 状态块。' };
  }
  const rawState = source.slice(start + KP_STATE_START.length, end).trim();
  const narrative = (source.slice(0, start) + source.slice(end + KP_STATE_END.length)).trim();
  try {
    const statePatch = JSON.parse(rawState);
    return { narrative, statePatch, rawState, error: null };
  } catch (error) {
    return {
      narrative,
      statePatch: null,
      rawState,
      error: `KP 状态块 JSON 解析失败：${error.message}`,
    };
  }
}

/**
 * 合并模型提交的增量状态。所有越权修改都会被忽略并记录 warning。
 */
export function mergeKpState(currentState, patch, module) {
  const state = normalizeKpState(currentState, module);
  const warnings = [];
  if (!isPlainObject(patch)) return { state, warnings: ['状态补丁不是对象，已忽略。'] };

  const chapters = module?.structure?.chapters || [];
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const scenes = flattenScenes(module);
  const sceneMap = new Map(scenes.map((item) => [item.scene.id, item]));
  const clues = new Map((module?.clues || []).map((clue) => [clue.id, clue]));
  const events = new Map((module?.events || []).map((event) => [event.id, event]));

  const oldChapterIndex = chapterIndex(module, state.currentChapterId);
  let nextChapterId = state.currentChapterId;
  if (chapterIds.has(patch.currentChapterId)) {
    const allowedIndex = chapterIndex(module, patch.currentChapterId);
    if (oldChapterIndex === -1 || allowedIndex <= oldChapterIndex + 1) {
      nextChapterId = patch.currentChapterId;
    } else {
      warnings.push('模型试图跳到未解锁章节，已忽略。');
    }
  } else if (patch.currentChapterId !== undefined && patch.currentChapterId !== null) {
    warnings.push('模型提交了不存在的章节 ID，已忽略。');
  }

  let nextSceneId = state.currentSceneId;
  if (sceneMap.has(patch.currentSceneId)) {
    const owner = sceneOwner(module, patch.currentSceneId);
    const ownerIndex = chapterIndex(module, owner?.id);
    const nextChapterUnlocked =
      state.unlockedContent.chapterIds.includes(owner?.id) ||
      nextChapterId === owner?.id ||
      ownerIndex <= oldChapterIndex + 1;
    if (nextChapterUnlocked) {
      nextSceneId = patch.currentSceneId;
      nextChapterId = owner?.id || nextChapterId;
    } else {
      warnings.push('模型试图进入未解锁场景，已忽略。');
    }
  } else if (patch.currentSceneId !== undefined && patch.currentSceneId !== null) {
    warnings.push('模型提交了不存在的场景 ID，已忽略。');
  }

  const visited = new Set([...state.visitedSceneIds, nextSceneId].filter(Boolean));
  for (const id of uniqueStrings(patch.visitedSceneIds)) {
    if (sceneMap.has(id)) visited.add(id);
    else warnings.push(`未知场景访问记录：${id}`);
  }

  const discovered = new Set(state.discoveredClueIds);
  for (const id of uniqueStrings(patch.discoveredClueIds)) {
    const clue = clues.get(id);
    if (!clue) {
      warnings.push(`未知线索：${id}`);
      continue;
    }
    if (clue.sceneId && !visited.has(clue.sceneId)) {
      warnings.push(`线索「${clue.title}」不属于已访问场景，已忽略。`);
      continue;
    }
    discovered.add(id);
  }

  const triggered = new Set(state.triggeredEventIds);
  for (const id of uniqueStrings(patch.triggeredEventIds)) {
    const event = events.get(id);
    if (!event) {
      warnings.push(`未知事件：${id}`);
      continue;
    }
    if (event.sceneId && !visited.has(event.sceneId)) {
      warnings.push(`事件「${event.title}」不在已访问场景，已忽略。`);
      continue;
    }
    triggered.add(id);
  }

  const unlocked = {
    chapterIds: new Set(state.unlockedContent.chapterIds),
    sceneIds: new Set(state.unlockedContent.sceneIds),
    clueIds: new Set(state.unlockedContent.clueIds),
  };
  if (nextChapterId) unlocked.chapterIds.add(nextChapterId);
  if (nextSceneId) unlocked.sceneIds.add(nextSceneId);
  const patchUnlocked = isPlainObject(patch.unlockedContent) ? patch.unlockedContent : {};
  for (const id of uniqueStrings(patchUnlocked.chapterIds)) {
    if (!chapterIds.has(id)) {
      warnings.push(`未知解锁章节：${id}`);
      continue;
    }
    const index = chapterIndex(module, id);
    if (index <= oldChapterIndex + 1 || unlocked.chapterIds.has(id)) unlocked.chapterIds.add(id);
    else warnings.push(`模型试图解锁更远的章节：${id}，已忽略。`);
  }
  for (const id of uniqueStrings(patchUnlocked.sceneIds)) {
    if (!sceneMap.has(id)) {
      warnings.push(`未知解锁场景：${id}`);
      continue;
    }
    const owner = sceneOwner(module, id);
    if (unlocked.chapterIds.has(owner?.id) || owner?.id === nextChapterId) unlocked.sceneIds.add(id);
    else warnings.push(`场景「${id}」所属章节未解锁，已忽略。`);
  }
  for (const id of uniqueStrings(patchUnlocked.clueIds)) {
    if (!clues.has(id)) {
      warnings.push(`未知解锁线索：${id}`);
      continue;
    }
    unlocked.clueIds.add(id);
  }

  const npcAttitudes = { ...state.npcAttitudes };
  if (isPlainObject(patch.npcAttitudes)) {
    for (const [npcId, value] of Object.entries(patch.npcAttitudes)) {
      if (!isPlainObject(value)) continue;
      npcAttitudes[npcId] = {
        attitude: typeof value.attitude === 'string' ? value.attitude : npcAttitudes[npcId]?.attitude || '中立',
        notes: typeof value.notes === 'string' ? value.notes : npcAttitudes[npcId]?.notes || '',
        lastInteraction:
          value.lastInteraction || npcAttitudes[npcId]?.lastInteraction || new Date().toISOString(),
      };
    }
  }

  const timeline = [...state.timeline];
  if (Array.isArray(patch.timeline)) {
    for (const entry of patch.timeline) {
      if (!entry || typeof entry.summary !== 'string') continue;
      timeline.push({
        inGameTime: String(entry.inGameTime || ''),
        summary: String(entry.summary),
        createdAt: entry.createdAt || new Date().toISOString(),
      });
    }
  }

  const flags = { ...state.flags };
  if (isPlainObject(patch.flags)) {
    for (const [key, value] of Object.entries(patch.flags)) {
      if (['string', 'number', 'boolean'].includes(typeof value) || value === null) flags[key] = value;
    }
  }

  return {
    state: {
      currentChapterId: nextChapterId,
      currentSceneId: nextSceneId,
      visitedSceneIds: [...visited],
      discoveredClueIds: [...discovered],
      triggeredEventIds: [...triggered],
      npcAttitudes,
      timeline: timeline.slice(-100),
      unlockedContent: {
        chapterIds: [...unlocked.chapterIds],
        sceneIds: [...unlocked.sceneIds],
        clueIds: [...unlocked.clueIds],
      },
      flags,
      lastKeeperSummary:
        typeof patch.lastKeeperSummary === 'string'
          ? patch.lastKeeperSummary
          : state.lastKeeperSummary,
    },
    warnings,
  };
}

/* =========================================================
 * 上下文组装
 * ========================================================= */

function formatNpcAttitudes(state) {
  return Object.entries(state?.npcAttitudes || {})
    .map(([id, value]) => `- ${id}：${value.attitude || '中立'}${value.notes ? `（${value.notes}）` : ''}`)
    .join('\n');
}

function formatCharacters(characters) {
  if (!characters?.length) return '（本场暂无玩家调查员）';
  return characters
    .map((character) => {
      const derived = character.derived || {};
      const skills = (character.skills || [])
        .filter((skill) => skill.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 12)
        .map((skill) => `${skill.name} ${skill.total}`)
        .join('、');
      const memories = (character.memories || [])
        .slice(-3)
        .map((memory) => `《${memory.moduleTitle || '过往模组'}》${memory.summary}`)
        .join('；');
      const roleplaySetting = String(character.detailedSetting || '').trim();
      return `### ${character.name}（${character.kind === 'npc' ? 'NPC' : 'PL'}）
- 职业：${character.occupation || '未填写'}；年龄：${character.age || '?'}
- HP ${derived.hp?.current ?? '?'}/${derived.hp?.max ?? '?'}；SAN ${derived.san?.current ?? '?'}/${derived.san?.max ?? '?'}；MP ${derived.mp?.current ?? '?'}/${derived.mp?.max ?? '?'}；MOV ${derived.mov ?? '?'}
- 关键技能：${skills || '未记录'}
- 重要物品：${(character.possessions || []).slice(0, 8).join('、') || '未记录'}
- 人设摘要：${String(character.background || character.appearance || '').slice(0, 260)}
${roleplaySetting ? `- 角色扮演设定摘要：${roleplaySetting.slice(0, 700)}` : ''}
${memories ? `- 跨模组记忆：${memories}` : ''}`;
    })
    .join('\n\n');
}

function selectWorldbookEntries(entries, query, characters, limit = 5) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const characterIds = new Set((characters || []).map((character) => character.id));
  const queryTokens = new Set(tokenize(query));
  const scored = entries.map((entry) => {
    const haystack = tokenize(`${entry.title || ''}\n${entry.content || ''}\n${(entry.tags || []).join(' ')}`);
    let score = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) score += 1;
    }
    if ((entry.characterIds || []).some((id) => characterIds.has(id))) score += 2;
    if (entry.type === 'memory') score += 1.5;
    if (entry.type === 'log') score += 0.5;
    return { ...entry, _score: score };
  });
  scored.sort((a, b) => b._score - a._score || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return scored.slice(0, Math.max(1, Math.min(12, limit)));
}

function formatWorldbook(entries) {
  if (!entries?.length) return '（暂无相关世界书记录。）';
  return entries
    .map(
      (entry, index) =>
        `### 世界书 ${index + 1} · ${entry.title || '未命名'}（${entry.type || 'note'}）\n${String(
          entry.content || ''
        ).slice(0, 1600)}`
    )
    .join('\n\n');
}

function formatChunks(chunks) {
  if (!chunks?.length) return '（本回合没有检索到相关模组片段。仅可进行不改变剧情的环境描写。）';
  return chunks
    .map(
      (chunk, index) =>
        `### 片段 ${index + 1} · ${chunk.title || '未命名'}（chapter:${chunk.chapterId || '?'} / scene:${
          chunk.sceneId || '?'
        }）
${chunk.text}`
    )
    .join('\n\n');
}

/**
 * 构建系统提示词。模组上下文只包含检索到的已解锁片段。
 */
export function buildKpSystemPrompt({
  module,
  state,
  characters,
  retrievedChunks,
  worldbookEntries = [],
  settings,
}) {
  const chapters = module?.structure?.chapters || [];
  const currentScene = findScene(module, state?.currentSceneId);
  const currentChapterIndex = chapters.findIndex((chapter) => chapter.id === state?.currentChapterId);
  const currentChapter = chapters[currentChapterIndex];
  const sceneIndex = (currentChapter?.scenes || []).findIndex(
    (scene) => scene.id === state?.currentSceneId
  );
  const isLastSceneOfChapter =
    currentChapter && sceneIndex >= 0 && sceneIndex === currentChapter.scenes.length - 1;
  const nextChapter = isLastSceneOfChapter ? chapters[currentChapterIndex + 1] : null;
  const nextEntryScene = nextChapter?.scenes?.[0] || null;
  const narrativeMin = Math.max(50, Number(settings?.narrativeMin) || 200);
  const narrativeMax = Math.max(narrativeMin + 50, Number(settings?.narrativeMax) || 400);

  return `你是《克苏鲁的呼唤》第七版（CoC 7e）的守秘人（Keeper, KP）。你正在主持模组《${module?.title || '未命名模组'}》。你必须严格依据下方提供的模组原文推进剧情，而不是自由创作。

【最高优先级硬约束】
1. 你只能依据提供的模组原文推进剧情。严禁编造模组中不存在的关键剧情、NPC、地点、线索、事件、怪物能力或结局。模组没有写明的信息，不能补写成既定事实。
2. 模组未写明的内容，只能做不改变剧情走向的环境与氛围描写。若玩家行动超出模组范围，用合理方式引导回模组主线，不得凭空创造新主线、新反派或新的关键线索。
3. 严禁提前泄露未解锁章节、场景、线索与真相。严格遵守信息释放节奏；玩家追问未解锁内容时，用模组内合理的方式回避、误导或引导，而不是直接告知。
4. 每次回复前，先在内部更新 KP 状态（当前场景、新线索、时间推进、NPC 态度），再输出叙事。叙事结束后必须附上规定的隐藏状态块。
5. 需要检定时，先在叙事中明确要求“哪种技能/属性检定、难度（常规/困难/极难）、奖励或惩罚骰”，然后等待玩家掷骰。绝对不得替玩家掷骰，不得直接宣布检定结果，不得编造骰点。
6. 输出格式：环境描写 + NPC 对话 + 可交互提示；使用中文；保持克苏鲁式的压抑、潮湿、未知氛围；单次回复约 ${narrativeMin}–${narrativeMax} 字。不要写选项列表式“1/2/3”，用自然语言给出可行动方向。
7. 不代替玩家做决定。不写玩家调查员的内心、台词、行动或感受；只描写 NPC、环境和玩家行动造成的可观察后果。
8. 不提及“提示词”“系统提示”“模组片段”“状态块”“AI”等元信息。状态块是给程序的隐藏数据，永远不能出现在叙事中。
9. 如果玩家试图攻击、逃跑、使用物品或技能，先判断是否需要检定；需要则停在检定前，等待骰子结果。
10. 如果模组信息与玩家行动冲突，以模组事实为准；玩家行动可以失败，但不能被强行改写为成功。

【当前 KP 状态 JSON】
${JSON.stringify(state, null, 2)}

【当前章节】
${currentChapter?.title || '未开始'}（ID: ${currentChapter?.id || '—'}）

【当前场景】
${currentScene?.scene?.title || '未开始'}（ID: ${currentScene?.scene?.id || '—'}）
${currentScene?.scene?.readAloud ? `\n朗读文本：\n${currentScene.scene.readAloud}` : ''}
${
  nextChapter && nextEntryScene
    ? `\n【下一章入口】
当前是本章最后一个场景。若且仅若玩家已经完成当前场景的必要内容、模组原文也允许转场，你可以把 currentChapterId 设为 ${nextChapter.id}、currentSceneId 设为 ${nextEntryScene.id}（${nextEntryScene.title}），并把它们加入 unlockedContent。下一章正文尚未注入；转场前不要虚构其内容。`
    : ''
}

【NPC 态度】
${formatNpcAttitudes(state) || '（暂无）'}

【玩家调查员摘要】
${formatCharacters(characters)}

【本回合检索到的已解锁模组原文】
${formatChunks(retrievedChunks)}

【世界书 / 历次跑团记录】
${formatWorldbook(worldbookEntries)}
（世界书是过去发生过的事实与角色记忆，可作为连续性参考，但不能替代本模组原文，也不能用于提前泄露本模组未解锁内容。）

【输出协议】
${KP_OUTPUT_PROTOCOL}

记住：你是守秘人，不是小说家。模组没有给出的关键事实，保持空白；玩家没有做出的选择，留给他们。`;
}

function normalizeHistoryMessage(message) {
  if (!message) return null;
  if (message.role === 'dice') {
    return {
      role: 'user',
      content: `【骰子结果】${message.content || ''}`,
    };
  }
  if (!['user', 'assistant'].includes(message.role)) return null;
  const content = String(message.content || '').trim();
  if (!content) return null;
  return { role: message.role, content };
}

/**
 * 组装完整上下文：检索 → 系统提示词 → 最近 N 轮 → 当前玩家输入。
 * @param {object} options
 * @param {object} options.module
 * @param {object} options.state
 * @param {Array} options.characters
 * @param {Array} options.history 聊天历史（可以包含当前 user，重复会自动去掉）
 * @param {string} options.userInput 当前行动
 * @param {object} options.settings { contextRounds, retrievalTopK, narrativeMin, narrativeMax }
 */
export function buildKpContext({
  module,
  state,
  characters,
  history = [],
  userInput = '',
  worldbook = [],
  settings = {},
}) {
  if (!module) throw new Error('尚未导入模组，无法组装 KP 上下文。');
  const normalizedState = normalizeKpState(state, module);
  const contextRounds = Math.max(2, Math.min(50, Number(settings.contextRounds) || 12));
  const topK = Math.max(1, Math.min(10, Number(settings.retrievalTopK) || 4));
  const query = [
    userInput,
    findScene(module, normalizedState.currentSceneId)?.scene?.title || '',
    normalizedState.lastKeeperSummary || '',
  ]
    .filter(Boolean)
    .join('\n');

  const allowedChapterIds = normalizedState.unlockedContent.chapterIds?.length
    ? normalizedState.unlockedContent.chapterIds
    : [normalizedState.currentChapterId].filter(Boolean);
  const retrievedChunks = retrieveChunks(module, query, {
    topK,
    currentSceneId: normalizedState.currentSceneId,
    allowedChapterIds,
  });
  const worldbookEntries = selectWorldbookEntries(
    worldbook,
    `${query}\n${(characters || []).map((character) => character.name).join(' ')}`,
    characters,
    5
  );

  const historyMessages = [];
  for (const message of history) {
    const normalized = normalizeHistoryMessage(message);
    if (!normalized) continue;
    // 如果最后一条正是当前输入，避免重复。
    if (
      userInput &&
      normalized.role === 'user' &&
      normalized.content === String(userInput).trim() &&
      message === history[history.length - 1]
    ) {
      continue;
    }
    historyMessages.push(normalized);
  }
  const recent = historyMessages.slice(-contextRounds * 2);

  const systemPrompt = buildKpSystemPrompt({
    module,
    state: normalizedState,
    characters,
    retrievedChunks,
    worldbookEntries,
    settings,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent,
  ];
  if (userInput && String(userInput).trim()) {
    messages.push({ role: 'user', content: `【玩家行动】\n${String(userInput).trim()}` });
  }

  return {
    messages,
    systemPrompt,
    retrievedChunks,
    worldbookEntries,
    state: normalizedState,
    query,
  };
}

/* =========================================================
 * 进度与展示
 * ========================================================= */

export function computeProgress(module, state) {
  const stats = moduleStats(module);
  const normalized = normalizeKpState(state, module);
  const chapters = module?.structure?.chapters || [];
  const currentChapter = chapters.find((chapter) => chapter.id === normalized.currentChapterId);
  const currentScene = findScene(module, normalized.currentSceneId)?.scene;
  const discovered = normalized.discoveredClueIds.length;
  const triggered = normalized.triggeredEventIds.length;
  const visited = normalized.visitedSceneIds.length;

  return {
    chapters: stats.chapters,
    scenes: stats.scenes,
    clues: stats.clues,
    npcs: stats.npcs,
    events: stats.events,
    visitedScenes: visited,
    discoveredClues: discovered,
    triggeredEvents: triggered,
    scenePercent: stats.scenes ? Math.min(100, (visited / stats.scenes) * 100) : 0,
    cluePercent: stats.clues ? Math.min(100, (discovered / stats.clues) * 100) : 0,
    chapterTitle: currentChapter?.title || '未开始',
    sceneTitle: currentScene?.title || '未开始',
    currentChapterId: normalized.currentChapterId,
    currentSceneId: normalized.currentSceneId,
  };
}

export function stateSummaryText(state) {
  return (
    `章节 ${state?.currentChapterId || '—'} / 场景 ${state?.currentSceneId || '—'}；` +
    `已访问 ${state?.visitedSceneIds?.length || 0} 个场景；` +
    `线索 ${state?.discoveredClueIds?.length || 0} 条；` +
    `事件 ${state?.triggeredEventIds?.length || 0} 个`
  );
}

export const kp = Object.freeze({
  KP_STATE_START,
  KP_STATE_END,
  KP_OUTPUT_PROTOCOL,
  createInitialKpState,
  normalizeKpState,
  parseKpStateBlock,
  mergeKpState,
  buildKpSystemPrompt,
  buildKpContext,
  computeProgress,
  stateSummaryText,
});

export default kp;
