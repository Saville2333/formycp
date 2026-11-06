/**
 * module-audit.js — 模组导入后的 AI 结构审计（DeepSeek / OpenAI 兼容接口）
 *
 * 目标不是让模型“重写模组”，而是：
 * 1. 找出切分、线索、事件、NPC 结构中的明显遗漏或问题；
 * 2. 用严格 JSON 返回审计结果；
 * 3. 前端只接受模组中真实存在的线索/事件标题，拒绝模型凭空添加内容。
 *
 * 推荐接口：DeepSeek
 *   baseURL: https://api.deepseek.com/v1
 *   model:   deepseek-chat
 */

import { api } from './api.js';
import { moduleStats } from './module.js';

export const MODULE_AUDIT_VERSION = 1;

export const MODULE_AUDIT_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版（CoC 7e）模组编辑与结构审校员。你的任务只是审计，不是续写。

硬性规则：
1. 只能依据用户提供的模组文本与结构清单进行分析。不得编造模组中不存在的章节、场景、线索、NPC、事件或真相。
2. 你可以指出“疑似遗漏”，但必须说明依据来自哪一段原文，不能把猜测写成事实。
3. 关键线索与必须触发事件只能从提供的已有标题中选择；不要创建新标题。
4. 不要输出剧情续写、玩家选项、NPC 台词或模组正文。
5. 只输出严格 JSON，不要 Markdown 代码围栏，不要解释文字。

输出结构：
{
  "verdict": "ok | warning | error",
  "summary": "一句到两句总体判断",
  "warnings": [
    {"code": "split | clue | event | npc | leak | consistency | other", "message": "具体问题", "sceneTitle": "可选，必须是已有场景标题"}
  ],
  "keyClues": [
    {"title": "必须与已有线索标题完全一致", "reason": "为什么它是关键线索"}
  ],
  "mustTriggerEvents": [
    {"title": "必须与已有事件标题完全一致", "reason": "为什么它必须触发"}
  ],
  "sceneIssues": [
    {"title": "必须与已有场景标题完全一致", "issue": "切分或内容问题", "suggestion": "可执行的修正建议"}
  ]
}`;

function normalizeTitle(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[：:·\-—]/g, '')
    .toLowerCase();
}

function clip(text, maxLength) {
  const source = String(text || '').trim();
  return source.length > maxLength ? source.slice(0, maxLength) : source;
}

/**
 * 把模组压缩成可审计的文本。超过预算时明确标记 truncated。
 */
export function buildModuleAuditText(module, { maxChars = 24000 } = {}) {
  const stats = moduleStats(module);
  const parts = [];
  let used = 0;
  let truncated = false;

  const push = (text) => {
    const piece = String(text || '').trim();
    if (!piece) return;
    const remaining = maxChars - used;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const clipped = piece.length > remaining ? piece.slice(0, remaining) : piece;
    if (clipped.length < piece.length) truncated = true;
    parts.push(clipped);
    used += clipped.length;
  };

  push(`模组标题：${module.title}\n简介：${module.description || '无'}\n结构：${stats.chapters} 章 / ${stats.scenes} 场景 / ${stats.clues} 线索 / ${stats.npcs} NPC / ${stats.events} 事件\n`);

  for (const chapter of module.structure?.chapters || []) {
    push(`\n# 章节：${chapter.title}\n`);
    for (const scene of chapter.scenes || []) {
      push(`\n## 场景：${scene.title}\n${scene.readAloud ? `朗读：${scene.readAloud}\n` : ''}${clip(scene.content, 2600)}\n`);
    }
  }

  push(`\n【已有线索标题】\n${(module.clues || []).map((clue) => clue.title).join(' / ') || '无'}`);
  push(`\n【已有 NPC 标题】\n${(module.npcs || []).map((npc) => npc.name).join(' / ') || '无'}`);
  push(`\n【已有事件标题】\n${(module.events || []).map((event) => event.title).join(' / ') || '无'}`);

  return {
    text: parts.join('\n'),
    truncated,
    chars: used,
    stats,
  };
}

export function buildModuleAuditMessages(module, options = {}) {
  const packed = buildModuleAuditText(module, options);
  return {
    messages: [
      { role: 'system', content: MODULE_AUDIT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请审计以下模组。${packed.truncated ? '注意：因上下文限制，正文只提供了前一部分，请只依据已提供的部分判断，不要猜测未提供内容。' : ''}\n\n${packed.text}`,
      },
    ],
    packed,
  };
}

export function parseModuleAuditResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI 审计没有返回 JSON 对象。');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`AI 审计 JSON 解析失败：${error.message}`);
  }
}

/**
 * 校验 AI 审计结果，只匹配模组中真实存在的标题。
 */
export function validateModuleAudit(payload, module) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('AI 审计结果必须是对象。');
  }
  const clues = new Map((module.clues || []).map((clue) => [normalizeTitle(clue.title), clue]));
  const events = new Map((module.events || []).map((event) => [normalizeTitle(event.title), event]));
  const scenes = new Map();
  for (const chapter of module.structure?.chapters || []) {
    for (const scene of chapter.scenes || []) scenes.set(normalizeTitle(scene.title), scene);
  }

  const warnings = [];
  const ignored = [];

  const warningList = Array.isArray(payload.warnings) ? payload.warnings : [];
  for (const item of warningList.slice(0, 50)) {
    if (typeof item === 'string' && item.trim()) {
      warnings.push({ code: 'other', message: item.trim(), sceneTitle: '' });
    } else if (item && typeof item.message === 'string' && item.message.trim()) {
      const sceneTitle = String(item.sceneTitle || '');
      warnings.push({
        code: String(item.code || 'other').slice(0, 30),
        message: item.message.trim().slice(0, 1000),
        sceneTitle: scenes.has(normalizeTitle(sceneTitle)) ? sceneTitle : '',
      });
    }
  }

  const keyClues = [];
  for (const item of Array.isArray(payload.keyClues) ? payload.keyClues : []) {
    const clue = clues.get(normalizeTitle(item?.title));
    if (!clue) {
      ignored.push(`未知线索：${item?.title || ''}`);
      continue;
    }
    keyClues.push({ clueId: clue.id, title: clue.title, reason: String(item.reason || '').slice(0, 500) });
  }

  const mustTriggerEvents = [];
  for (const item of Array.isArray(payload.mustTriggerEvents) ? payload.mustTriggerEvents : []) {
    const event = events.get(normalizeTitle(item?.title));
    if (!event) {
      ignored.push(`未知事件：${item?.title || ''}`);
      continue;
    }
    mustTriggerEvents.push({
      eventId: event.id,
      title: event.title,
      reason: String(item.reason || '').slice(0, 500),
    });
  }

  const sceneIssues = [];
  for (const item of Array.isArray(payload.sceneIssues) ? payload.sceneIssues : []) {
    const scene = scenes.get(normalizeTitle(item?.title));
    if (!scene) {
      ignored.push(`未知场景：${item?.title || ''}`);
      continue;
    }
    sceneIssues.push({
      sceneId: scene.id,
      title: scene.title,
      issue: String(item.issue || '').slice(0, 800),
      suggestion: String(item.suggestion || '').slice(0, 800),
    });
  }

  return {
    valid: true,
    ignored,
    audit: {
      verdict: ['ok', 'warning', 'error'].includes(payload.verdict) ? payload.verdict : 'warning',
      summary: String(payload.summary || '').slice(0, 1500),
      warnings,
      keyClues,
      mustTriggerEvents,
      sceneIssues,
    },
  };
}

/**
 * 将已验证审计应用到模组：标记关键线索/事件，并保存 aiAudit。
 */
export function applyModuleAudit(module, audit, { provider = '', model = '', truncated = false, chars = 0 } = {}) {
  const clueMap = new Map((module.clues || []).map((clue) => [clue.id, clue]));
  const eventMap = new Map((module.events || []).map((event) => [event.id, event]));
  for (const item of audit.keyClues || []) {
    const clue = clueMap.get(item.clueId);
    if (clue) clue.isKey = true;
  }
  for (const item of audit.mustTriggerEvents || []) {
    const event = eventMap.get(item.eventId);
    if (event) event.mustTrigger = true;
  }
  module.aiAudit = {
    version: MODULE_AUDIT_VERSION,
    verdict: audit.verdict,
    summary: audit.summary,
    warnings: audit.warnings,
    keyClues: audit.keyClues,
    mustTriggerEvents: audit.mustTriggerEvents,
    sceneIssues: audit.sceneIssues,
    ignored: audit.ignored || [],
    provider,
    model,
    truncated: Boolean(truncated),
    charsAudited: chars,
    checkedAt: new Date().toISOString(),
  };
  module.updatedAt = new Date().toISOString();
  return module;
}

/**
 * 调用接口做一次模组审计。失败时抛出错误，由调用方决定是否仍保存模组。
 */
export async function auditModuleWithAI(module, profile, { maxChars = 24000, signal, onStatus } = {}) {
  if (!profile) throw new Error('请先配置用于模组检测的 AI 接口。');
  const { messages, packed } = buildModuleAuditMessages(module, { maxChars });
  if (onStatus) onStatus('正在调用 AI 审校模组结构…');
  const result = await api.complete(profile, messages, {
    signal,
    useWebSearch: false,
    retries: 1,
    timeoutMs: 120000,
  });
  if (onStatus) onStatus('AI 已返回，正在校验检测结果…');
  const payload = parseModuleAuditResponse(result.content);
  const validation = validateModuleAudit(payload, module);
  applyModuleAudit(module, validation.audit, {
    provider: profile.name || 'AI',
    model: profile.model || '',
    truncated: packed.truncated,
    chars: packed.chars,
  });
  return {
    audit: validation.audit,
    ignored: validation.ignored,
    usage: result.usage,
    durationMs: result.durationMs,
    chars: packed.chars,
    truncated: packed.truncated,
  };
}

export const moduleAudit = Object.freeze({
  MODULE_AUDIT_SYSTEM_PROMPT,
  buildModuleAuditText,
  buildModuleAuditMessages,
  parseModuleAuditResponse,
  validateModuleAudit,
  applyModuleAudit,
  auditModuleWithAI,
});

export default moduleAudit;
