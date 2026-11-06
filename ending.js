/**
 * ending.js — 战役结局与玩家角色记忆
 *
 * 设计原则：
 * 1. 结局必须落在模组已写明的剧情、线索、事件与角色行为上；
 * 2. 只从玩家视角（POV）收束，不把其他角色的私密信息写成公开结局；
 * 3. AI 不可用时用 KP 状态与最后叙事生成可读的兜底结局；
 * 4. 记忆结果只返回给 POV，是否写入人设由玩家在 UI 中选择。
 */

import { api } from './api.js';
import { fallbackMemory } from './memory.js';

export const ENDING_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版的战役收束守秘人。你必须在模组结束时，为玩家视角调查员分配一个严格符合模组文本的结局。

硬性规则：
1. 只能使用提供的模组结构、已解锁内容、KP 状态、已触发事件、已获得线索与聊天记录，不得凭空改写关键事实。
2. 以玩家视角角色为中心；其他调查员只写玩家能观察到的命运，不得揭晓他们的私密信息。
3. 如果模组已写明结局/失败条件，按已发生的事件与角色行为选择最接近的结局；如果没有写明，只能给出模组主题允许的开放收束，不能自创大团圆。
4. endingText 控制在 300–700 个中文字符，必须明确玩家角色的最终命运、代价与余波。
5. memory 是玩家角色主观长期记忆，200–600 字，不写 KP 全知视角。
6. 只输出严格 JSON，不要 Markdown 代码围栏。

输出：
{
  "endingTitle": "结局标题",
  "endingText": "300–700 字的结局叙述",
  "povFate": "一句话概括玩家角色最终命运",
  "memory": {
    "summary": "200–600 字的角色主观记忆",
    "keyEvents": ["最多 6 条"],
    "relationships": ["最多 6 条"],
    "unresolved": ["最多 6 条"]
  }
}`;

function clip(text, maxLength) {
  const source = String(text || '').trim();
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

function transcriptText(chat, maxChars = 12000) {
  const messages = (chat?.messages || []).slice(-60);
  const parts = [];
  let used = 0;
  for (const message of messages) {
    if (!['user', 'assistant', 'dice', 'system'].includes(message.role)) continue;
    const label =
      message.role === 'assistant'
        ? 'KP'
        : message.role === 'dice'
          ? '骰子'
          : message.speaker || '调查员';
    const piece = `【${label}】${clip(message.content, 1000)}`;
    if (used + piece.length > maxChars) break;
    parts.push(piece);
    used += piece.length;
  }
  return parts.join('\n\n');
}

function moduleOutline(module) {
  return (module?.structure?.chapters || [])
    .map(
      (chapter) =>
        `## ${chapter.title}\n${clip(chapter.summary, 260)}\n${(chapter.scenes || [])
          .map(
            (scene) =>
              `- ${scene.title}：${clip(scene.summary || scene.readAloud, 300)}${
                scene.content ? `\n  原文摘要：${clip(scene.content, 420)}` : ''
              }`
          )
          .join('\n')}`
    )
    .join('\n\n');
}

export function buildEndingMessages({
  campaign,
  module,
  povCharacter,
  characters = [],
  privateNotes = [],
  roleAssignments = [],
  chat,
}) {
  const state = campaign?.kpState || {};
  const role = roleAssignments.find((assignment) => assignment.characterId === povCharacter?.id);
  return [
    { role: 'system', content: ENDING_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【模组】
《${module?.title || campaign?.moduleTitle || '未命名'}》
${clip(module?.description, 800)}

【模组章节大纲】
${moduleOutline(module)}

【已发现线索】
${(module?.clues || [])
  .filter((clue) => (state.discoveredClueIds || []).includes(clue.id))
  .map((clue) => `- ${clue.title}：${clip(clue.description, 300)}`)
  .join('\n') || '无'}

【已触发事件】
${(module?.events || [])
  .filter((event) => (state.triggeredEventIds || []).includes(event.id))
  .map((event) => `- ${event.title}：${clip(event.description, 300)}`)
  .join('\n') || '无'}

【KP 状态】
${JSON.stringify(
  {
    currentChapterId: state.currentChapterId,
    currentSceneId: state.currentSceneId,
    visitedSceneIds: state.visitedSceneIds,
    discoveredClueIds: state.discoveredClueIds,
    triggeredEventIds: state.triggeredEventIds,
    npcAttitudes: state.npcAttitudes,
    timeline: state.timeline,
    flags: state.flags,
    lastKeeperSummary: state.lastKeeperSummary,
  },
  null,
  2
)}

【玩家视角角色】
姓名：${povCharacter?.name || '未指定'}
本场身份：${role ? `${role.code} · ${role.title}` : '未分配 HO'}
公开身份：${clip(role?.publicInfo, 1200) || '无'}
身份结局提示：${clip(role?.ending, 800) || '模组未为该身份写明结局'}
角色详细设定：${clip(povCharacter?.detailedSetting || povCharacter?.background, 1800) || '无'}
该角色知道的私密信息：${privateNotes.map((note) => clip(note.content, 1500)).join('；') || '无'}
HP ${povCharacter?.derived?.hp?.current ?? '?'}/${povCharacter?.derived?.hp?.max ?? '?'}；SAN ${
        povCharacter?.derived?.san?.current ?? '?'}/${povCharacter?.derived?.san?.max ?? '?'
      }

【其他调查员（只允许写可观察命运）】
${roleAssignments
  .filter((assignment) => assignment.characterId !== povCharacter?.id)
  .map((assignment) => {
    const character = characters.find((item) => item.id === assignment.characterId);
    return `- ${character?.name || assignment.characterId}：${assignment.code} · ${
      assignment.title
    }；公开：${clip(assignment.publicInfo, 300)}`;
  })
  .join('\n') || '无'}

【聊天记录】
${transcriptText(chat) || '无'}

请严格依据以上内容，为 ${povCharacter?.name || '玩家角色'} 写出最终结局与角色记忆。`,
    },
  ];
}

export function parseEndingResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('结局生成没有返回 JSON。');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function fallbackEnding({ campaign, module, povCharacter }) {
  const state = campaign?.kpState || {};
  const timeline = (state.timeline || []).slice(-6).map((entry) => entry.summary);
  const clues = (module?.clues || [])
    .filter((clue) => (state.discoveredClueIds || []).includes(clue.id))
    .map((clue) => clue.title);
  const endingText = [
    `《${module?.title || campaign?.moduleTitle || '未命名模组'}》的调查在此收束。`,
    state.lastKeeperSummary || '',
    timeline.length ? `最后的片段是：${timeline.join('；')}。` : '',
    clues.length ? `${povCharacter?.name || '调查员'}仍记得${clues.join('、')}。` : '',
    '真相没有因为调查结束而变得温和；活下来的人必须带着它继续生活。',
  ]
    .filter(Boolean)
    .join('');
  return {
    endingTitle: '调查收束',
    endingText: clip(endingText, 700),
    povFate: '带着未竟的疑问离开现场。',
    memory: fallbackMemory(povCharacter, { campaign, module }),
  };
}

export function validateEnding(payload, { campaign, module, povCharacter }) {
  const endingTitle = String(payload?.endingTitle || '').trim() || '结局';
  const endingText = String(payload?.endingText || '').trim();
  if (endingText.length < 30) throw new Error('结局文本过短。');
  const memory = payload?.memory && typeof payload.memory === 'object' ? payload.memory : null;
  const summary = String(memory?.summary || '').trim();
  if (!summary) throw new Error('结局没有包含角色记忆。');
  return {
    ending: {
      title: endingTitle,
      text: endingText.slice(0, 1600),
      povFate: String(payload?.povFate || '').slice(0, 500),
      at: new Date().toISOString(),
    },
    memory: {
      characterId: povCharacter?.id || '',
      summary: summary.slice(0, 1200),
      keyEvents: Array.isArray(memory.keyEvents) ? memory.keyEvents.map(String).slice(0, 8) : [],
      relationships: Array.isArray(memory.relationships)
        ? memory.relationships.map(String).slice(0, 8)
        : [],
      unresolved: Array.isArray(memory.unresolved)
        ? memory.unresolved.map(String).slice(0, 8)
        : [],
    },
    moduleTitle: module?.title || campaign?.moduleTitle || '',
  };
}

export async function generateCampaignEnding({
  profile,
  campaign,
  module,
  povCharacter,
  characters = [],
  privateNotes = [],
  roleAssignments = [],
  chat,
}) {
  const messages = buildEndingMessages({
    campaign,
    module,
    povCharacter,
    characters,
    privateNotes,
    roleAssignments,
    chat,
  });
  try {
    const completion = await api.complete(profile, messages, {
      useWebSearch: false,
      retries: 1,
      timeoutMs: 120000,
      maxTokens: 3000,
    });
    return {
      ...validateEnding(parseEndingResponse(completion.content), {
        campaign,
        module,
        povCharacter,
      }),
      ai: true,
      error: '',
    };
  } catch (error) {
    return {
      ...validateEnding(fallbackEnding({ campaign, module, povCharacter }), {
        campaign,
        module,
        povCharacter,
      }),
      ai: false,
      error: error.message,
    };
  }
}

export const ending = Object.freeze({
  ENDING_SYSTEM_PROMPT,
  buildEndingMessages,
  parseEndingResponse,
  fallbackEnding,
  validateEnding,
  generateCampaignEnding,
});

export default ending;
