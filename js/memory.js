/**
 * memory.js — 模组结束后的跨战役角色记忆总结
 *
 * 跑完一个模组后，将本场战役压缩为每位调查员的长期记忆：
 * - summary：这段经历对角色意味着什么；
 * - keyEvents：角色亲历的关键事件；
 * - relationships：NPC / 同伴关系变化；
 * - unresolved：尚未解决的线索或执念。
 *
 * 记忆写回 Character.memories，并在下一次模组中进入 KP 与 AI 代演的上下文。
 */

import { api } from './api.js';

export const MEMORY_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版（CoC 7e）的战役记录员。你的任务是把一场已经结束的模组，压缩成每位调查员的长期记忆。

硬性规则：
1. 只能依据提供的聊天记录、KP 状态、时间线、线索与角色设定总结，不得编造未发生的事件。
2. 以角色的主观视角记录：他/她经历了什么、学到了什么、失去了什么、对谁产生了什么态度。
3. 不要写成 KP 的剧情大纲；要写成“这个角色会记住的事”。
4. 每位角色一条记忆，summary 控制在 200–600 个中文字符。
5. 只输出严格 JSON，不要 Markdown 代码围栏，不要解释。

输出：
{
  "memories": [
    {
      "characterId": "必须是输入中的角色 id",
      "summary": "200–600 字的角色主观记忆",
      "keyEvents": ["角色亲历的关键事件，最多 6 条"],
      "relationships": ["关系变化，例如：房东太太——不再信任，最多 6 条"],
      "unresolved": ["未解决的线索或执念，最多 6 条"]
    }
  ]
}`;

function clip(text, maxLength) {
  const source = String(text || '').trim();
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

function createMemoryId() {
  if (globalThis.crypto?.randomUUID) return `mem_${crypto.randomUUID()}`;
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function transcriptText(chat, maxChars = 16000) {
  const messages = (chat?.messages || []).slice(-80);
  const parts = [];
  let used = 0;
  for (const message of messages) {
    if (!['user', 'assistant', 'dice', 'system'].includes(message.role)) continue;
    const label = message.role === 'dice' ? '骰子' : message.role === 'assistant' ? 'KP' : message.speaker || '调查员';
    const piece = `【${label}】${clip(message.content, 1200)}`;
    if (used + piece.length > maxChars) break;
    parts.push(piece);
    used += piece.length;
  }
  return parts.join('\n\n');
}

function worldbookText(entries, maxChars = 5000) {
  return (entries || [])
    .slice(0, 20)
    .map((entry) => `【${entry.title}】${clip(entry.content, 600)}`)
    .join('\n')
    .slice(0, maxChars);
}

export function buildCampaignMemoryMessages({ campaign, module, characters, chat, worldbook = [] }) {
  const state = campaign?.kpState || {};
  const characterBlocks = (characters || [])
    .map(
      (character) => `### ${character.name}（id: ${character.id}）
- 职业：${character.occupation || '未知'}；年龄：${character.age || '?'}
- 详细设定摘要：${clip(character.detailedSetting || character.background || '', 1200)}
- 既有记忆：${(character.memories || []).slice(-3).map((memory) => clip(memory.summary, 400)).join(' / ') || '无'}`
    )
    .join('\n\n');

  return [
    { role: 'system', content: MEMORY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `模组：《${module?.title || campaign?.moduleTitle || '未命名'}》
战役：${campaign?.title || '未命名战役'}
状态：${JSON.stringify(
        {
          currentChapterId: state.currentChapterId,
          currentSceneId: state.currentSceneId,
          visitedSceneIds: state.visitedSceneIds,
          discoveredClueIds: state.discoveredClueIds,
          triggeredEventIds: state.triggeredEventIds,
          npcAttitudes: state.npcAttitudes,
          timeline: state.timeline,
          lastKeeperSummary: state.lastKeeperSummary,
        },
        null,
        2
      )}

【调查员】
${characterBlocks}

【已发现线索】
${(module?.clues || [])
  .filter((clue) => (state.discoveredClueIds || []).includes(clue.id))
  .map((clue) => `- ${clue.title}：${clip(clue.description, 300)}`)
  .join('\n') || '无'}

【世界书 / 本场记录】
${worldbookText(worldbook) || '无'}

【聊天记录】
${transcriptText(chat)}

请为每位角色输出长期记忆 JSON。角色 id 必须原样返回。`,
    },
  ];
}

export function parseMemoryResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('记忆总结没有返回 JSON。');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`记忆 JSON 解析失败：${error.message}`);
  }
}

export function fallbackMemory(character, { campaign, module }) {
  const state = campaign?.kpState || {};
  const timeline = (state.timeline || []).slice(-5).map((entry) => entry.summary);
  const clues = (module?.clues || [])
    .filter((clue) => (state.discoveredClueIds || []).includes(clue.id))
    .map((clue) => clue.title);
  const summary = [
    `在《${module?.title || campaign?.moduleTitle || '未命名模组'}》中，${character.name}完成了这次调查。`,
    state.lastKeeperSummary || '',
    timeline.length ? `记忆最深的片段：${timeline.join('；')}。` : '',
    clues.length ? `仍记得这些线索：${clues.join('、')}。` : '',
  ]
    .filter(Boolean)
    .join('');
  return {
    characterId: character.id,
    summary: clip(summary, 600),
    keyEvents: timeline.slice(0, 6),
    relationships: Object.entries(state.npcAttitudes || {})
      .slice(0, 6)
      .map(([npcId, value]) => `${npcId}——${value.attitude || '中立'}`),
    unresolved: clues.slice(0, 6),
  };
}

export function validateMemories(payload, characters) {
  const allowed = new Map((characters || []).map((character) => [character.id, character]));
  const memories = [];
  for (const item of Array.isArray(payload?.memories) ? payload.memories : []) {
    const character = allowed.get(item?.characterId);
    if (!character) continue;
    const summary = String(item.summary || '').trim();
    if (!summary) continue;
    memories.push({
      characterId: character.id,
      summary: summary.slice(0, 1200),
      keyEvents: Array.isArray(item.keyEvents) ? item.keyEvents.map(String).slice(0, 8) : [],
      relationships: Array.isArray(item.relationships)
        ? item.relationships.map(String).slice(0, 8)
        : [],
      unresolved: Array.isArray(item.unresolved) ? item.unresolved.map(String).slice(0, 8) : [],
    });
  }
  return memories;
}

/**
 * 调用 AI 为整场战役生成记忆；缺失的角色用本地状态生成兜底记忆。
 */
export async function summarizeCampaignMemories({
  profile,
  campaign,
  module,
  characters,
  chat,
  worldbook = [],
  callModel = null,
}) {
  const messages = buildCampaignMemoryMessages({ campaign, module, characters, chat, worldbook });
  let aiMemories = [];
  let error = '';
  try {
    const text = callModel
      ? await callModel(messages)
      : (
          await api.complete(profile, messages, {
            useWebSearch: false,
            retries: 1,
            timeoutMs: 120000,
            // 多角色记忆需要比普通对话更长的输出预算。
            maxTokens: Math.max(3000, Number(profile?.maxTokens) || 0),
          })
        ).content;
    aiMemories = validateMemories(parseMemoryResponse(text), characters);
  } catch (err) {
    error = err.message;
  }

  const byId = new Map(aiMemories.map((memory) => [memory.characterId, memory]));
  const complete = characters.map(
    (character) => byId.get(character.id) || fallbackMemory(character, { campaign, module })
  );
  return { memories: complete, aiCount: aiMemories.length, error };
}

export function attachMemoriesToCharacters(characters, memories, { campaign, module }) {
  const now = new Date().toISOString();
  const byId = new Map(memories.map((memory) => [memory.characterId, memory]));
  return characters.map((character) => {
    const memory = byId.get(character.id);
    if (!memory) return character;
    const list = Array.isArray(character.memories) ? character.memories : [];
    // 同一战役重复总结时覆盖旧记忆，避免重复堆积。
    const filtered = list.filter((item) => item.campaignId !== campaign.id);
    filtered.push({
      id: createMemoryId(),
      campaignId: campaign.id,
      moduleId: campaign.moduleId || module?.id || '',
      moduleTitle: module?.title || campaign.moduleTitle || '',
      summary: memory.summary,
      keyEvents: memory.keyEvents || [],
      relationships: memory.relationships || [],
      unresolved: memory.unresolved || [],
      createdAt: now,
    });
    return { ...character, memories: filtered, updatedAt: now };
  });
}

export function memoryToWorldbookEntry(memory, character, { campaign, module }) {
  return {
    campaignId: campaign.id,
    moduleId: campaign.moduleId || module?.id || '',
    moduleTitle: module?.title || campaign.moduleTitle || '',
    type: 'memory',
    title: `${character.name} 的记忆 · ${module?.title || campaign.moduleTitle || '模组'}`,
    content: [
      memory.summary,
      memory.keyEvents?.length ? `\n关键事件：${memory.keyEvents.join('；')}` : '',
      memory.relationships?.length ? `\n关系变化：${memory.relationships.join('；')}` : '',
      memory.unresolved?.length ? `\n未解决：${memory.unresolved.join('；')}` : '',
    ].join(''),
    tags: ['角色记忆', character.name, module?.title || ''].filter(Boolean),
    characterIds: [character.id],
    source: 'memory',
    importance: 4,
    includeInContext: true,
  };
}

export const memory = Object.freeze({
  MEMORY_SYSTEM_PROMPT,
  buildCampaignMemoryMessages,
  parseMemoryResponse,
  fallbackMemory,
  validateMemories,
  summarizeCampaignMemories,
  attachMemoriesToCharacters,
  memoryToWorldbookEntry,
});

export default memory;
