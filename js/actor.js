/**
 * actor.js — AI 代演玩家角色
 *
 * 约束：
 * - 角色回复 ≤ 100 个字符（按 Unicode 字符计，含标点）；
 * - 必须包含一个明确的行动；
 * - 必须从角色卡技能中选择一项用于自动检定；
 * - 只输出严格 JSON，由前端掷骰，不替 KP 描写结果。
 */

import { api } from './api.js';
import { formatCheckResult } from './dice.js';

export const ACTOR_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版中的玩家角色代演器。你必须以调查员本人的口吻与视角行动。

硬性规则：
1. reply 必须不超过 100 个字符（含标点），超长直接判为失败。
2. reply 必须包含一个明确、具体、可执行的行动；不能只写内心想法或空泛台词。
3. 必须从角色技能中选择一项用于本次行动检定，输出 skill；difficulty 只能是 regular / hard / extreme。
4. 不替守秘人描写行动结果，不宣布成功或失败，不编造骰点，不控制其他角色。
5. 遵守角色详细设定、既有记忆与世界书；不知道的事不要装作知道。
6. 只输出严格 JSON，不要 Markdown 代码围栏：
{
  "reply": "不超过100字，包含台词与行动",
  "action": "一句话概括的行动",
  "skill": "角色卡中的技能名",
  "difficulty": "regular",
  "reason": "为什么用这个技能检定"
}`;

function clip(text, maxLength) {
  const source = String(text || '').trim();
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

function charLength(text) {
  return Array.from(String(text || '')).length;
}

function characterSkills(character) {
  return (character?.skills || []).filter((skill) => skill.total > 0);
}

function worldbookText(entries, limit = 6) {
  return (entries || [])
    .slice(0, limit)
    .map((entry) => `【${entry.title}】${clip(entry.content, 700)}`)
    .join('\n');
}

export function buildActorMessages({ character, campaign, module, chat, worldbook = [] }) {
  const memories = (character.memories || [])
    .slice(-5)
    .map((memory) => `《${memory.moduleTitle || '过往模组'}》${memory.summary}`)
    .join('\n');
  const recent = (chat?.messages || [])
    .slice(-10)
    .filter((message) => ['user', 'assistant', 'dice'].includes(message.role))
    .map((message) => {
      const label =
        message.role === 'assistant' ? 'KP' : message.role === 'dice' ? '骰子' : message.speaker || '调查员';
      return `【${label}】${clip(message.content, 900)}`;
    })
    .join('\n\n');
  const skills = characterSkills(character)
    .sort((a, b) => b.total - a.total)
    .map((skill) => `${skill.name} ${skill.total}`)
    .join('、');
  const derived = character.derived || {};
  const detail = character.detailedSetting || character.background || '';

  return [
    { role: 'system', content: ACTOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【调查员】
姓名：${character.name}
职业：${character.occupation || '未知'}；年龄：${character.age || '?'}
HP ${derived.hp?.current ?? '?'}/${derived.hp?.max ?? '?'}；SAN ${derived.san?.current ?? '?'}/${derived.san?.max ?? '?'}；MP ${derived.mp?.current ?? '?'}/${derived.mp?.max ?? '?'}
技能：${skills || '无'}
随身物品：${(character.possessions || []).slice(0, 12).join('、') || '无'}

【详细角色设定】
${clip(detail, 12000) || '未填写'}

【跨模组记忆】
${memories || '无'}

【世界书 / 过往记录】
${worldbookText(worldbook) || '无'}

【当前模组与场景】
模组：${module?.title || campaign?.moduleTitle || '未命名'}
战役：${campaign?.title || '未命名'}
当前章节：${campaign?.kpState?.currentChapterId || '未记录'}
当前场景：${campaign?.kpState?.currentSceneId || '未记录'}
KP 内部摘要：${clip(campaign?.kpState?.lastKeeperSummary || '', 1000) || '无'}

【最近对话】
${recent || '（尚未开始）'}

请以${character.name}的身份做出下一步行动。reply 不超过 100 字符，并选择一个技能自动检定。`,
    },
  ];
}

export function parseActorResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI 代演没有返回 JSON。');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`AI 代演 JSON 解析失败：${error.message}`);
  }
}

export function validateActorResponse(payload, character) {
  const reply = String(payload?.reply || '').trim();
  const action = String(payload?.action || '').trim();
  const skills = characterSkills(character);
  const skillNames = new Set(skills.map((skill) => skill.name));
  const errors = [];
  if (!reply) errors.push('reply 不能为空。');
  if (charLength(reply) > 100) errors.push(`reply 为 ${charLength(reply)} 字，超过 100 字上限。`);
  if (!action) errors.push('action 不能为空。');
  const requestedSkill = String(payload?.skill || '').trim();
  const fallbackSkill = skills.find((skill) => skill.name === '侦查')?.name || skills[0]?.name || '';
  const skill = skillNames.has(requestedSkill) ? requestedSkill : fallbackSkill;
  if (requestedSkill && !skillNames.has(requestedSkill)) {
    errors.push(`skill「${requestedSkill}」不在角色卡技能中。`);
  }
  if (!skill) errors.push('角色没有可用于检定的技能。');
  const difficulty = ['regular', 'hard', 'extreme'].includes(payload?.difficulty)
    ? payload.difficulty
    : 'regular';
  return {
    valid: errors.length === 0,
    errors,
    value: {
      reply,
      action,
      skill,
      difficulty,
      reason: String(payload?.reason || '').slice(0, 300),
      length: charLength(reply),
    },
  };
}

/**
 * 调用模型生成一次 AI 代演行动。超长/格式错误时带错误反馈重试一次。
 */
export async function generateActorAction({
  profile,
  character,
  campaign,
  module,
  chat,
  worldbook = [],
  maxRetries = 1,
}) {
  if (!profile) throw new Error('请先配置 AI 接口。');
  const messages = buildActorMessages({ character, campaign, module, chat, worldbook });
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const completion = await api.complete(profile, messages, {
      useWebSearch: false,
      retries: 1,
      timeoutMs: 60000,
      maxTokens: 600,
    });
    try {
      const payload = parseActorResponse(completion.content);
      const validation = validateActorResponse(payload, character);
      if (validation.valid) {
        return { ...validation.value, raw: payload, usage: completion.usage, attempts: attempt + 1 };
      }
      lastError = validation.errors.join(' ');
    } catch (error) {
      lastError = error.message;
    }
    messages.push(
      { role: 'assistant', content: completion.content },
      {
        role: 'user',
        content: `上一条输出不符合要求：${lastError}。请重新输出严格 JSON；reply 必须 ≤100 字，必须包含具体行动，skill 必须是角色技能之一。`,
      }
    );
  }
  throw new Error(`AI 代演没有通过校验：${lastError}`);
}

export function formatActorCheck(actorAction, check) {
  return `${actorAction.reply}\n（${actorAction.skill} · ${formatCheckResult(check)}）`;
}

export const actor = Object.freeze({
  ACTOR_SYSTEM_PROMPT,
  buildActorMessages,
  parseActorResponse,
  validateActorResponse,
  generateActorAction,
  formatActorCheck,
});

export default actor;
