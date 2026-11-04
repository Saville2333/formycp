/**
 * module-editor.js — 导入模组时的 AI 校订对话
 *
 * 模型不直接改结构化对象，而是返回“完整修订后的 Markdown 原文”；
 * 前端重新解析，因此结构、分块、检索索引都会同步重建。
 */

import { api } from './api.js';

export const MAX_EDIT_CHARS = 40000;

export const MODULE_EDITOR_SYSTEM_PROMPT = `你是《克苏鲁的呼唤》第七版的模组编辑与守秘人助手。用户在导入模组时与你对话，要求你修改模组文本。

硬性规则：
1. 只输出完整修订后的模组 Markdown 原文，放在一个 \`\`\`markdown 代码块中；代码块外不要写解释、前言、总结或道歉。
2. 除用户明确要求修改的内容外，逐字保留原文；不要擅自改写剧情事实、HO 秘密、线索、NPC、结局。
3. 保留 Markdown 标题层级：章节用 #，场景用 ##，线索/NPC/事件/HO 用 ### 或 ##。
4. 保留 HO 身份格式：HO1：标题、HO2：标题，以及“公开信息/秘密/人设/目标/结局”标签。
5. 如果用户要求补充内容，必须写成可直接使用的模组正文，不要只给建议。
6. 如果用户要求删除或合并内容，返回删除后的完整文本，不要保留省略号。
7. 不得泄露现实世界隐私，不得输出与模组编辑无关的内容。`;

export function buildModuleEditMessages({ text, title = '', request = '' }) {
  return [
    { role: 'system', content: MODULE_EDITOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【当前模组标题】${title || '未命名模组'}

【当前完整原文】
${text}

【本次修改要求】
${request}

请返回完整修订后的模组 Markdown，放在 \`\`\`markdown 代码块中。`,
    },
  ];
}

function cleanExtractedText(source) {
  let text = String(source || '').trim();
  if (!text) return '';
  const fenced = [...text.matchAll(/```(?:markdown|md|text)?\s*\n([\s\S]*?)```/gi)];
  if (fenced.length) {
    text = fenced
      .map((match) => match[1].trim())
      .sort((a, b) => b.length - a.length)[0];
  }
  // 去掉模型在代码块外附带的“以下是修改后的模组：”之类前言。
  const heading = text.search(/^#{1,6}\s/m);
  if (heading > 0 && heading < 500 && !text.slice(0, heading).includes('\n#')) {
    text = text.slice(heading);
  }
  return text.trim();
}

export function extractEditedModuleText(raw) {
  const text = cleanExtractedText(raw);
  if (!text) throw new Error('模型没有返回可用的模组文本。');
  if (text.length < 80) throw new Error('模型返回的模组文本过短，可能被截断。');
  return text;
}

/**
 * 让 AI 基于当前全文做一次修改，返回完整新文本。
 * 任一失败都不会覆盖调用方的当前文本。
 */
export async function editModuleWithAI({
  profile,
  text,
  title = '',
  request = '',
  maxRetries = 1,
}) {
  if (!profile) throw new Error('请先配置 AI 接口。');
  if (!String(text || '').trim()) throw new Error('模组原文为空。');
  if (!String(request || '').trim()) throw new Error('请输入修改要求。');
  if (String(text).length > MAX_EDIT_CHARS) {
    throw new Error(
      `当前模组约 ${String(text).length} 字，超过 AI 单次校订上限 ${MAX_EDIT_CHARS} 字。请先手动分段精简，或直接编辑左侧原文。`
    );
  }
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const completion = await api.complete(
        profile,
        buildModuleEditMessages({ text, title, request }),
        {
          useWebSearch: false,
          retries: 1,
          timeoutMs: 180000,
          // 返回的是完整模组，不能沿用普通聊天的短输出预算。
          maxTokens: Math.max(6000, Number(profile.maxTokens) || 0, Math.ceil(text.length / 2)),
        }
      );
      const edited = extractEditedModuleText(completion.content);
      if (edited.length < Math.max(120, Math.floor(text.length * 0.2))) {
        throw new Error('修订后的文本明显短于原文，可能被截断，未应用。');
      }
      return {
        text: edited,
        raw: completion.content,
        usage: completion.usage,
        attempts: attempt + 1,
        truncated: false,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
    }
  }
  throw new Error(`AI 校订失败：${lastError?.message || '未知错误'}`);
}

export const moduleEditor = Object.freeze({
  MAX_EDIT_CHARS,
  MODULE_EDITOR_SYSTEM_PROMPT,
  buildModuleEditMessages,
  extractEditedModuleText,
  editModuleWithAI,
});

export default moduleEditor;
