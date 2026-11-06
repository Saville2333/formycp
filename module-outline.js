/**
 * module-outline.js — 导入模组后生成“正典大纲 + 场景原文”并写入世界书
 *
 * 设计原则：
 * 1. 场景条目直接保留模组原文，不交给 AI 改写；
 * 2. AI 只负责阅读全文、整理大纲与章节摘要，且标题必须能在模组中找到；
 * 3. 世界书中的 outline / scene 条目会被 KP 强制注入，作为严格模组的事实准绳；
 * 4. 没有 AI 接口时仍可用本地规则生成完整大纲。
 */

import { api } from './api.js';
import { storage } from './storage.js';

export const OUTLINE_SCAN_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版的模组校对员。你的任务只是阅读并整理模组结构，不得创作新剧情。

硬性规则：
1. 只能使用提供的模组章节、场景、线索、事件与 HO 原文；不得新增人物、地点、线索、事件或结局。
2. 章节与场景标题必须原样返回，不得改写；无法确认的内容放入 warnings。
3. overview 是三段以内的模组结构摘要，不是续写。
4. 只输出严格 JSON，不要 Markdown 代码围栏。

输出：
{
  "overview": "模组结构摘要",
  "chapters": [
    {
      "title": "必须与原文章节标题完全一致",
      "summary": "本章发生了什么；只总结原文",
      "scenes": [{"title": "必须与原文场景标题完全一致", "summary": "本场景的原文事实"}]
    }
  ],
  "canonicalRules": ["KP 必须遵守的模组硬事实，最多 12 条"],
  "warnings": ["结构不清或可能缺失的内容"]
}`;

function clip(text, max) {
  const source = String(text || '').trim();
  return source.length > max ? `${source.slice(0, max)}…` : source;
}

export function buildLocalModuleEntries(module) {
  const chapters = module?.structure?.chapters || [];
  const roles = module?.roles || [];
  const clues = module?.clues || [];
  const events = module?.events || [];
  const overviewLines = [
    `模组：${module?.title || '未命名模组'}`,
    module?.description ? `简介：${clip(module.description, 1200)}` : '',
    '',
    '【章节顺序】',
    ...chapters.map((chapter, index) => `${index + 1}. ${chapter.title}`),
    '',
    roles.length
      ? `【HO 身份】\n${roles
          .map(
            (role) =>
              `- ${role.code} ${role.title}：${clip(role.publicInfo || role.summary, 400)}${
                role.privateInfo ? `\n  私密：${clip(role.privateInfo, 400)}` : ''
              }`
          )
          .join('\n')}`
      : '',
    clues.length
      ? `【关键线索】\n${clues
          .map((clue) => `- ${clue.title}：${clip(clue.description, 240)}`)
          .join('\n')}`
      : '',
    events.length
      ? `【必须/可能事件】\n${events
          .map((event) => `- ${event.title}：${clip(event.description, 240)}`)
          .join('\n')}`
      : '',
  ].filter(Boolean);

  const entries = [
    {
      campaignId: '',
      moduleId: module?.id || '',
      moduleTitle: module?.title || '',
      chapterId: '',
      type: 'outline',
      title: `《${module?.title || '未命名模组'}》总览`,
      content: overviewLines.join('\n'),
      tags: ['模组总览', module?.title || ''],
      characterIds: [],
      sceneId: '',
      source: 'module',
      importance: 5,
      includeInContext: true,
    },
    ...chapters.map((chapter, chapterIndex) => ({
      campaignId: '',
      moduleId: module?.id || '',
      moduleTitle: module?.title || '',
      chapterId: chapter.id || '',
      type: 'outline',
      title: `章节大纲 · ${chapter.title}`,
      content: [
        `章节：${chapterIndex + 1}. ${chapter.title}`,
        clip(chapter.summary, 600),
        '',
        '【本场景顺序（只列标题，不提前注入后续内容）】',
        ...(chapter.scenes || []).map(
          (scene, sceneIndex) => `${chapterIndex + 1}.${sceneIndex + 1} ${scene.title}`
        ),
      ].join('\n'),
      tags: ['章节大纲', chapter.title],
      characterIds: [],
      sceneId: '',
      source: 'module',
      importance: 5,
      includeInContext: true,
    })),
  ];

  for (const chapter of chapters) {
    for (const scene of chapter.scenes || []) {
      entries.push({
        campaignId: '',
        moduleId: module?.id || '',
        moduleTitle: module?.title || '',
        chapterId: chapter.id || '',
        type: 'scene',
        title: `场景 · ${scene.title}`,
        content: [
          `章节：${chapter.title}`,
          `场景：${scene.title}`,
          '',
          '【模组原文】',
          String(scene.content || scene.readAloud || scene.summary || '').slice(0, 48000),
        ].join('\n'),
        tags: ['场景原文', chapter.title, scene.title].filter(Boolean),
        characterIds: [],
        sceneId: scene.id || '',
        source: 'module',
        importance: 5,
        includeInContext: true,
      });
    }
  }

  return entries;
}

function buildScanMessages(module) {
  const chapters = module?.structure?.chapters || [];
  const source = [
    `模组：${module?.title || '未命名模组'}`,
    module?.description ? `简介：${clip(module.description, 1200)}` : '',
    ...chapters.map(
      (chapter, chapterIndex) =>
        `## ${chapterIndex + 1}. ${chapter.title}\n${clip(chapter.content || chapter.summary, 1800)}\n${(
          chapter.scenes || []
        )
          .map(
            (scene) =>
              `### ${scene.title}\n${clip(scene.content || scene.readAloud || scene.summary, 2200)}`
          )
          .join('\n')}`
    ),
  ].join('\n\n');
  return [
    { role: 'system', content: OUTLINE_SCAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `以下是导入的模组结构。请只整理，不要续写。\n\n${clip(source, 26000)}\n\n请返回严格 JSON。`,
    },
  ];
}

export function parseOutlineResponse(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('大纲扫描没有返回 JSON。');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function validateOutline(payload, module) {
  if (!payload || typeof payload !== 'object') throw new Error('大纲 JSON 不是对象。');
  const chapterTitles = new Set(
    (module?.structure?.chapters || []).map((chapter) => String(chapter.title))
  );
  const chapters = [];
  let ignored = 0;
  for (const chapter of Array.isArray(payload.chapters) ? payload.chapters : []) {
    const title = String(chapter?.title || '').trim();
    if (!chapterTitles.has(title)) {
      ignored += 1;
      continue;
    }
    chapters.push({
      title,
      summary: String(chapter.summary || '').slice(0, 1600),
      scenes: Array.isArray(chapter.scenes)
        ? chapter.scenes
            .map((scene) => ({
              title: String(scene?.title || '').slice(0, 300),
              summary: String(scene?.summary || '').slice(0, 1200),
            }))
            .slice(0, 100)
        : [],
    });
  }
  return {
    overview: String(payload.overview || '').slice(0, 3000),
    chapters,
    canonicalRules: Array.isArray(payload.canonicalRules)
      ? payload.canonicalRules.map(String).slice(0, 12)
      : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String).slice(0, 20) : [],
    ignored,
  };
}

export async function scanModuleWithAI({ profile, module }) {
  if (!profile) throw new Error('未配置 AI 接口。');
  const completion = await api.complete(profile, buildScanMessages(module), {
    useWebSearch: false,
    retries: 1,
    timeoutMs: 120000,
    maxTokens: 4000,
  });
  return validateOutline(parseOutlineResponse(completion.content), module);
}

function mergeOutlineContent(module, localContent, scan) {
  if (!scan?.overview && !scan?.chapters?.length) return localContent;
  const aiLines = [
    '【AI 结构摘要（仅辅助理解，不替代场景原文）】',
    scan.overview,
    '',
    ...scan.chapters.flatMap((chapter) => [
      `## ${chapter.title}`,
      chapter.summary,
      ...(chapter.scenes || []).map(
        (scene) => `- ${scene.title}：${clip(scene.summary, 500)}`
      ),
    ]),
    scan.canonicalRules.length
      ? `\n【KP 硬事实】\n${scan.canonicalRules.map((rule) => `- ${rule}`).join('\n')}`
      : '',
    scan.warnings.length
      ? `\n【结构提醒】\n${scan.warnings.map((warning) => `- ${warning}`).join('\n')}`
      : '',
    '',
    '【本地原文大纲（最终准绳）】',
    localContent,
  ];
  return aiLines.filter(Boolean).join('\n');
}

/**
 * 清掉本模块旧的 outline/scene 条目，并写入新的“正典大纲 + 场景原文”。
 * AI 只影响大纲摘要，场景条目始终从模组对象原文生成。
 */
export async function syncModuleWorldbook(module, { profile = null, useAI = false } = {}) {
  if (!module?.id) return { entries: [], ai: false, error: '模组缺少 id。' };
  const existing = await storage.worldbook.list().catch(() => []);
  for (const entry of existing) {
    if (
      entry.moduleId === module.id &&
      entry.source === 'module' &&
      ['outline', 'scene'].includes(entry.type)
    ) {
      await storage.worldbook.remove(entry.id);
    }
  }
  const localEntries = buildLocalModuleEntries(module);
  let scan = null;
  let error = '';
  if (useAI && profile) {
    try {
      scan = await scanModuleWithAI({ profile, module });
    } catch (err) {
      error = err.message;
    }
  }
  if (scan) {
    const outline = localEntries.find((entry) => entry.type === 'outline');
    if (outline) {
      outline.content = mergeOutlineContent(module, outline.content, scan);
      outline.tags = [...new Set([...(outline.tags || []), 'AI 扫描'])];
    }
  }
  const saved = [];
  for (const entry of localEntries) {
    saved.push(await storage.worldbook.save(entry));
  }
  return { entries: saved, ai: Boolean(scan), error };
}

export const moduleOutline = Object.freeze({
  OUTLINE_SCAN_SYSTEM_PROMPT,
  buildLocalModuleEntries,
  parseOutlineResponse,
  validateOutline,
  scanModuleWithAI,
  syncModuleWorldbook,
});

export default moduleOutline;
