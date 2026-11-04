/**
 * module.js — 模组导入、结构切分、关键词索引与检索
 *
 * 设计目标：
 * 1. 尽量不依赖模型，把纯文本/Markdown 切分成章节—场景—线索—NPC—事件；
 * 2. 保留原始文本，所有检索只返回原文分块，绝不用摘要替代；
 * 3. 用中文二元词 + 英文单词建立轻量倒排索引，并按 TF-IDF 排序；
 * 4. 支持手动标记关键线索、必须触发事件与修正切分。
 *
 * 注意：自动切分是“可编辑的初稿”，不是不可修改的最终结构。
 */

export const MODULE_SCHEMA_VERSION = 1;

export class ModuleError extends Error {
  constructor(message, { code = 'MODULE_ERROR', details = [] } = {}) {
    super(message);
    this.name = 'ModuleError';
    this.code = code;
    this.details = details;
  }
}

const CHINESE_STOPWORDS = new Set([
  '的',
  '了',
  '和',
  '是',
  '在',
  '有',
  '与',
  '及',
  '或',
  '一个',
  '这个',
  '那个',
  '可以',
  '没有',
  '已经',
  '因为',
  '所以',
  '如果',
  '但是',
  '然后',
  '你们',
  '他们',
  '我们',
  '什么',
  '怎么',
  '这里',
  '那里',
  '以及',
  '进行',
  '出现',
  '发现',
  '看到',
]);

const DEFAULT_CHUNK_SIZE = 1200;
const MAX_CHUNK_SIZE = 2400;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix, index) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${index}_${random}`;
}

function normalizeNewlines(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/^>+\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function firstMeaningfulLine(text) {
  return (
    normalizeNewlines(text)
      .split('\n')
      .map((line) => stripMarkdown(line).trim())
      .find(Boolean) || ''
  );
}

function sliceText(text, maxLength = 140) {
  const source = String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

/* =========================================================
 * 分词与关键词
 * ========================================================= */

/**
 * 中文用二元词（bigram）+ 单字兜底；英文用长度 ≥2 的小写单词。
 * 这比纯关键词更耐口语化查询，又不需要向量模型。
 */
export function tokenize(text) {
  const source = String(text ?? '')
    .toLowerCase()
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ');

  const tokens = [];
  const chunks = source.split(/\s+/).filter(Boolean);
  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/.test(chunk)) {
      if (chunk.length >= 2 && !CHINESE_STOPWORDS.has(chunk)) tokens.push(chunk);
      continue;
    }
    if (/\p{Script=Han}/u.test(chunk)) {
      const characters = Array.from(chunk);
      for (const character of characters) {
        if (!CHINESE_STOPWORDS.has(character)) tokens.push(character);
      }
      for (let index = 0; index < characters.length - 1; index += 1) {
        const bigram = characters[index] + characters[index + 1];
        if (!CHINESE_STOPWORDS.has(bigram)) tokens.push(bigram);
      }
    }
  }
  return tokens;
}

export function extractKeywords(text, limit = 12) {
  const counts = new Map();
  for (const token of tokenize(text)) {
    if (token.length < 2) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

/* =========================================================
 * 文本切分
 * ========================================================= */

export function splitIntoChunks(text, maxLength = DEFAULT_CHUNK_SIZE) {
  const size = Math.max(300, Math.min(MAX_CHUNK_SIZE, Number(maxLength) || DEFAULT_CHUNK_SIZE));
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  const pushLongParagraph = (paragraph) => {
    const sentences = paragraph
      .split(/(?<=[。！？!?；;])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    let piece = '';
    for (const sentence of sentences) {
      if ((piece + sentence).length > size && piece) {
        chunks.push(piece.trim());
        piece = '';
      }
      piece += sentence;
    }
    if (piece.trim()) chunks.push(piece.trim());
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      pushCurrent();
      pushLongParagraph(paragraph);
      continue;
    }
    if ((current + '\n\n' + paragraph).length > size && current) pushCurrent();
    current += (current ? '\n\n' : '') + paragraph;
  }
  pushCurrent();
  return chunks;
}

/* =========================================================
 * Markdown / 文本结构解析
 * ========================================================= */

function parseHeadingTree(text) {
  const root = { level: 0, title: 'ROOT', children: [], content: [] };
  const stack = [root];
  const lines = normalizeNewlines(text).split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      const node = {
        level: match[1].length,
        title: stripMarkdown(match[2]).trim(),
        children: [],
        content: [],
      };
      while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].content.push(line);
    }
  }
  return root;
}

function collectNodeText(node, { includeChildren = true, skipNodes = null } = {}) {
  const parts = [...node.content];
  if (includeChildren) {
    for (const child of node.children) {
      if (skipNodes?.has(child)) continue;
      parts.push(
        `\n## ${child.title}\n`,
        collectNodeText(child, { includeChildren: true, skipNodes })
      );
    }
  }
  return parts.join('\n').trim();
}

function extractReadAloud(text) {
  const lines = normalizeNewlines(text).split('\n');
  const readAloud = [];
  for (const line of lines) {
    if (/^>\s?/.test(line) || /^【(朗读|宣读|读 aloud)】/i.test(line)) {
      readAloud.push(stripMarkdown(line).replace(/^【[^】]+】\s*/, '').trim());
    }
  }
  return readAloud.join('\n').trim();
}

function detectSpecialSections(sceneNode, sceneId, chapterId, counters, skipNodes = null) {
  const clues = [];
  const npcs = [];
  const events = [];

  function walk(node) {
    for (const child of node.children) {
      if (skipNodes?.has(child)) continue;
      const title = child.title;
      const description = collectNodeText(child, { includeChildren: true });
      if (/线索/.test(title)) {
        clues.push({
          id: createId('clue', ++counters.clue),
          title: title.replace(/^线索[：:\s-]*/, '').trim() || title,
          description,
          sceneId,
          chapterId,
          type: 'other',
          isKey: /关键|核心|必须/.test(title + description),
          revealed: false,
          revealCondition: '',
          notes: '',
        });
      } else if (/(NPC|人物|角色)/i.test(title)) {
        npcs.push({
          id: createId('npc', ++counters.npc),
          name: title.replace(/^(NPC|人物|角色)[：:\s-]*/i, '').trim() || title,
          role: '',
          attitude: '',
          description,
          secrets: '',
          sceneIds: [sceneId],
        });
      } else if (/事件|触发/.test(title)) {
        events.push({
          id: createId('evt', ++counters.event),
          title: title.replace(/^事件[：:\s-]*/, '').trim() || title,
          description,
          chapterId,
          sceneId,
          mustTrigger: /必须|关键|核心/.test(title + description),
          triggerCondition: '',
          triggered: false,
        });
      }
      walk(child);
    }
  }

  walk(sceneNode);
  return { clues, npcs, events };
}

const ROLE_HEADING =
  /^(HO\s*\d+|PC\s*\d+|玩家角色\s*\d*|角色\s*[A-Za-z0-9一二三四五六七八九十]+)\s*[：:、.\-—–]?\s*(.*)$/i;
const ROLE_HEADING_PREFIXED =
  /^(?:角色|身份)\s*[：:]\s*(HO\s*\d+|PC\s*\d+)\s*[：:、.\-—–]?\s*(.*)$/i;

const ROLE_FIELD_LABELS = [
  { key: 'publicInfo', label: '公开信息', regex: /^(?:公开信息|公开设定|公开情报|所有人知道|公开)[：:]\s*/ },
  {
    key: 'privateInfo',
    label: '私密信息',
    regex: /^(?:秘密|私密信息|私密设定|只有你知道|仅你(?:自己)?知道|隐藏信息)[：:]\s*/,
  },
  { key: 'persona', label: '角色设定', regex: /^(?:人设|角色设定|人物设定|扮演|性格)[：:]\s*/ },
  { key: 'ending', label: '结局', regex: /^(?:结局|命运|最终结局)[：:]\s*/ },
  { key: 'goals', label: '目标', regex: /^(?:目标|目的|动机)[：:]\s*/ },
];

function matchRoleField(line) {
  const cleaned = stripMarkdown(line).trim();
  for (const field of ROLE_FIELD_LABELS) {
    if (field.regex.test(cleaned)) {
      return { key: field.key, value: cleaned.replace(field.regex, '').trim() };
    }
  }
  return null;
}

function parseRoleFields(body) {
  const fields = {};
  let current = '';
  for (const rawLine of normalizeNewlines(body).split('\n')) {
    if (/^#{1,6}\s/.test(rawLine)) continue;
    const matched = matchRoleField(rawLine);
    if (matched) {
      current = matched.key;
      fields[current] = [fields[current], matched.value].filter(Boolean).join('\n').trim();
      continue;
    }
    if (!current || !rawLine.trim()) continue;
    fields[current] = `${fields[current] || ''}\n${stripMarkdown(rawLine)}`.trim();
  }
  const goals = (fields.goals || '')
    .split(/\n|[；;、]/)
    .map((item) => item.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  return { ...fields, goals };
}

function extractRoles(root) {
  const roles = [];
  const nodes = new Set();
  let counter = 0;

  function walk(node) {
    for (const child of node.children) {
      const matched = child.title.match(ROLE_HEADING) || child.title.match(ROLE_HEADING_PREFIXED);
      if (matched) {
        const body = collectNodeText(child, { includeChildren: true }).trim();
        const fields = parseRoleFields(body);
        const code = matched[1].replace(/\s+/g, '').toUpperCase();
        const title = matched[2].trim() || '未命名身份';
        const publicInfo = sliceText(fields.publicInfo || body, fields.publicInfo ? 4000 : 600);
        const privateInfo = sliceText(fields.privateInfo || body, 16000);
        const persona = sliceText(fields.persona || body, 12000);
        roles.push({
          id: createId('role', ++counter),
          code,
          title,
          summary: sliceText(publicInfo || body, 220),
          publicInfo,
          privateInfo,
          persona,
          goals: fields.goals || [],
          ending: sliceText(fields.ending || '', 4000),
          description: sliceText(body, 24000),
        });
        nodes.add(child);
      }
      walk(child);
    }
  }

  walk(root);
  return { roles, nodes };
}

/** 兼容旧模组：没有 roles 字段时，从 rawText 重新扫描 HO 标题。 */
export function parseRolesFromText(text) {
  if (!String(text || '').trim()) return [];
  return extractRoles(parseHeadingTree(normalizeNewlines(text))).roles;
}

function buildFromTree(root, { title, fileName, type }) {
  const roleData = extractRoles(root);
  const roleNodes = roleData.nodes;
  const isRoleContainer = (node) => {
    if (!/^(角色|身份|HO|PC|玩家角色|角色分配)/i.test(node.title || '')) return false;
    const children = node.children.filter((child) => child.level === node.level + 1);
    return children.length > 0 && children.every((child) => roleNodes.has(child));
  };
  const h1 = root.children.filter(
    (node) => node.level === 1 && !roleNodes.has(node) && !isRoleContainer(node)
  );
  const h2 = root.children.filter((node) => node.level === 2 && !roleNodes.has(node));
  const chapterNodes = h1.length ? h1 : [];
  let syntheticChapter = null;

  if (!chapterNodes.length) {
    syntheticChapter = {
      level: 1,
      title: title || firstMeaningfulLine(root.content.join('\n')) || '导入的模组',
      children: h2,
      content: root.content,
    };
    chapterNodes.push(syntheticChapter);
  }

  const chapters = [];
  const chunks = [];
  const clues = [];
  const npcs = [];
  const events = [];
  const counters = { chapter: 0, scene: 0, clue: 0, npc: 0, event: 0, chunk: 0 };

  for (const chapterNode of chapterNodes) {
    const chapterId = createId('ch', ++counters.chapter);
    let sceneNodes = chapterNode.children.filter(
      (node) => node.level === 2 && !roleNodes.has(node)
    );
    if (!sceneNodes.length) {
      sceneNodes = [
        {
          level: 2,
          title: chapterNode.title,
          children: chapterNode.children.filter(
            (node) => node.level > 2 && !roleNodes.has(node)
          ),
          content: chapterNode.content,
        },
      ];
    }

    const scenes = [];
    for (const sceneNode of sceneNodes) {
      const sceneId = createId('sc', ++counters.scene);
      const body = collectNodeText(sceneNode, { includeChildren: true, skipNodes: roleNodes });
      const special = detectSpecialSections(sceneNode, sceneId, chapterId, counters, roleNodes);
      clues.push(...special.clues);
      for (const npc of special.npcs) {
        const existing = npcs.find((item) => item.name === npc.name);
        if (existing) existing.sceneIds.push(sceneId);
        else npcs.push(npc);
      }
      events.push(...special.events);

      scenes.push({
        id: sceneId,
        title: sceneNode.title || `场景 ${scenes.length + 1}`,
        order: scenes.length,
        summary: sliceText(body, 180),
        readAloud: extractReadAloud(body),
        content: body,
        clueIds: special.clues.map((clue) => clue.id),
        npcIds: special.npcs.map((npc) => npc.id),
        eventIds: special.events.map((event) => event.id),
        isKeyScene: false,
      });

      const textChunks = splitIntoChunks(body);
      for (const piece of textChunks) {
        chunks.push({
          id: createId('chunk', ++counters.chunk),
          title: sceneNode.title,
          chapterId,
          sceneId,
          text: piece,
          keywords: extractKeywords(`${sceneNode.title}\n${piece}`, 16),
          tokenEstimate: Math.ceil(piece.length / 2),
          order: chunks.length,
          mustNotLeakBeforeUnlock: true,
        });
      }
    }

    chapters.push({
      id: chapterId,
      title: chapterNode.title,
      order: chapters.length,
      summary: sliceText(
        collectNodeText(chapterNode, { includeChildren: false, skipNodes: roleNodes }) ||
          scenes[0]?.summary,
        240
      ),
      unlocked: chapters.length === 0,
      scenes,
    });
  }

  // 没有标题的纯文本也需要至少一个场景。
  if (!chunks.length) {
    const chapterId = createId('ch', 1);
    const sceneId = createId('sc', 1);
    const body = normalizeNewlines(root.content.join('\n')).trim() || normalizeNewlines(title);
    chapters.push({
      id: chapterId,
      title: title || '导入的模组',
      order: 0,
      summary: sliceText(body, 240),
      unlocked: true,
      scenes: [
        {
          id: sceneId,
          title: title || '导入内容',
          order: 0,
          summary: sliceText(body, 180),
          readAloud: '',
          content: body,
          clueIds: [],
          npcIds: [],
          eventIds: [],
          isKeyScene: false,
        },
      ],
    });
    for (const piece of splitIntoChunks(body)) {
      chunks.push({
        id: createId('chunk', ++counters.chunk),
        title: title || '导入内容',
        chapterId,
        sceneId,
        text: piece,
        keywords: extractKeywords(piece, 16),
        tokenEstimate: Math.ceil(piece.length / 2),
        order: chunks.length,
        mustNotLeakBeforeUnlock: true,
      });
    }
  }

  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    title: title || firstMeaningfulLine(root.content.join('\n')) || '未命名模组',
    system: 'coc7e',
    author: '',
    version: '',
    language: 'zh-CN',
    description: '',
    contentWarnings: [],
    source: {
      type: type || 'paste',
      fileName: fileName || '',
      importedAt: nowIso(),
      rawText: normalizeNewlines(root.content.length ? '' : ''),
    },
    structure: { chapters },
    chunks,
    clues,
    npcs,
    events,
    roles: roleData.roles,
    retrieval: { method: 'tfidf', index: {}, builtAt: nowIso() },
    meta: {
      estimatedDuration: '',
      playerCount: '',
      keeperNotes: '',
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function typeFromFilename(fileName) {
  const extension = String(fileName || '').split('.').pop()?.toLowerCase();
  if (extension === 'md' || extension === 'markdown') return 'md';
  if (extension === 'json') return 'json';
  if (extension === 'txt') return 'txt';
  return 'paste';
}

function normalizeRole(input, index = 0) {
  const role = input && typeof input === 'object' ? input : {};
  return {
    id: String(role.id || createId('role', index + 1)),
    code: String(role.code || `HO${index + 1}`),
    title: String(role.title || role.name || '未命名身份'),
    summary: String(role.summary || role.publicInfo || role.description || '').slice(0, 600),
    publicInfo: String(role.publicInfo || role.public || role.summary || '').slice(0, 4000),
    privateInfo: String(role.privateInfo || role.secret || role.private || '').slice(0, 8000),
    persona: String(role.persona || role.setting || role.description || '').slice(0, 12000),
    goals: Array.isArray(role.goals) ? role.goals.map(String).slice(0, 12) : [],
    ending: String(role.ending || '').slice(0, 4000),
    description: String(role.description || role.persona || '').slice(0, 12000),
  };
}

function normalizeExistingModule(input, { fileName, type }) {
  const module = JSON.parse(JSON.stringify(input));
  module.schemaVersion = MODULE_SCHEMA_VERSION;
  module.system = 'coc7e';
  module.title = String(module.title || fileName?.replace(/\.[^.]+$/, '') || '未命名模组');
  module.language = module.language || 'zh-CN';
  module.source = {
    type: type || module.source?.type || 'json',
    fileName: fileName || module.source?.fileName || '',
    importedAt: module.source?.importedAt || nowIso(),
    rawText: module.source?.rawText || JSON.stringify(input),
  };
  module.structure = module.structure || { chapters: [] };
  module.chunks = Array.isArray(module.chunks) ? module.chunks : [];
  module.clues = Array.isArray(module.clues) ? module.clues : [];
  module.npcs = Array.isArray(module.npcs) ? module.npcs : [];
  module.events = Array.isArray(module.events) ? module.events : [];
  module.roles = Array.isArray(module.roles)
    ? module.roles.map((role, index) => normalizeRole(role, index))
    : [];
  module.meta = module.meta || {};

  if (!module.chunks.length && Array.isArray(module.structure.chapters)) {
    let chunkIndex = 0;
    for (const chapter of module.structure.chapters) {
      chapter.id = chapter.id || createId('ch', chapter.order ?? 0);
      for (const scene of chapter.scenes || []) {
        scene.id = scene.id || createId('sc', ++chunkIndex);
        const text = scene.content || scene.readAloud || scene.summary || '';
        for (const piece of splitIntoChunks(text)) {
          module.chunks.push({
            id: createId('chunk', ++chunkIndex),
            title: scene.title,
            chapterId: chapter.id,
            sceneId: scene.id,
            text: piece,
            keywords: extractKeywords(`${scene.title}\n${piece}`, 16),
            tokenEstimate: Math.ceil(piece.length / 2),
            order: module.chunks.length,
            mustNotLeakBeforeUnlock: true,
          });
        }
      }
    }
  }
  module.retrieval = module.retrieval?.index ? module.retrieval : { method: 'tfidf', index: {}, builtAt: nowIso() };
  module.createdAt = module.createdAt || nowIso();
  module.updatedAt = nowIso();
  return module;
}

/**
 * 解析文本/Markdown/JSON。返回尚未保存的模块对象（storage.saveModule 会分配 id）。
 */
export function parseModuleFile({ text, fileName = '', title = '' } = {}) {
  const source = normalizeNewlines(text);
  if (!source.trim()) throw new ModuleError('模组内容为空。', { code: 'EMPTY_MODULE' });
  const type = typeFromFilename(fileName);

  if (type === 'json' || /^\s*[\[{]/.test(source)) {
    let payload;
    try {
      payload = JSON.parse(source);
    } catch (error) {
      throw new ModuleError(`模组 JSON 无法解析：${error.message}`, { code: 'INVALID_MODULE_JSON' });
    }
    const candidate =
      payload?.format === 'cthulhu-table.module' && payload.module
        ? payload.module
        : payload?.module || payload;
    if (!candidate || typeof candidate !== 'object') {
      throw new ModuleError('模组 JSON 必须是一个对象。', { code: 'INVALID_MODULE_JSON' });
    }
    if (candidate.structure) return normalizeExistingModule(candidate, { fileName, type });
    // 普通 JSON 里如果有 content/rawText，则按文本解析；否则把 JSON 格式化后作为纯文本。
    const textContent =
      typeof candidate.content === 'string'
        ? candidate.content
        : typeof candidate.rawText === 'string'
          ? candidate.rawText
          : JSON.stringify(candidate, null, 2);
    const jsonTree = parseHeadingTree(textContent);
    const jsonFirstH1 = jsonTree.children.find((node) => node.level === 1)?.title;
    const parsed = buildFromTree(jsonTree, {
      title: title || jsonFirstH1 || candidate.title || fileName.replace(/\.[^.]+$/, ''),
      fileName,
      type: 'json',
    });
    parsed.source.rawText = source;
    parsed.description = candidate.description || '';
    return buildRetrievalIndex(parsed);
  }

  const tree = parseHeadingTree(source);
  const firstH1 = tree.children.find((node) => node.level === 1)?.title;
  const module = buildFromTree(tree, {
    title: title || firstH1 || fileName.replace(/\.[^.]+$/, '') || '未命名模组',
    fileName,
    type,
  });
  module.source.rawText = source;
  return buildRetrievalIndex(module);
}

/* =========================================================
 * 索引与检索
 * ========================================================= */

export function buildRetrievalIndex(module) {
  const index = {};
  for (const chunk of module.chunks || []) {
    const tokens = new Set(
      tokenize(`${chunk.title || ''}\n${chunk.text || ''}\n${(chunk.keywords || []).join(' ')}`)
    );
    for (const token of tokens) {
      if (!index[token]) index[token] = [];
      index[token].push(chunk.id);
    }
  }
  module.retrieval = {
    method: 'tfidf',
    index,
    builtAt: nowIso(),
  };
  return module;
}

function countToken(tokens, target) {
  let count = 0;
  for (const token of tokens) if (token === target) count += 1;
  return count;
}

/**
 * 检索与玩家行动最相关的模组分块。
 * @param {object} module
 * @param {string} query
 * @param {{topK?:number,currentSceneId?:string,allowedChapterIds?:string[]}} options
 */
export function retrieveChunks(module, query, { topK = 4, currentSceneId = '', allowedChapterIds = null } = {}) {
  if (!module) return [];
  const chunks = Array.isArray(module.chunks) ? module.chunks : [];
  if (!chunks.length) return [];
  const index = module.retrieval?.index && Object.keys(module.retrieval.index).length
    ? module.retrieval.index
    : buildRetrievalIndex(module).retrieval.index;

  const queryTokens = [...new Set(tokenize(query))].slice(0, 60);
  const allowed = allowedChapterIds ? new Set(allowedChapterIds) : null;
  const filtered = chunks.filter((chunk) => !allowed || allowed.has(chunk.chapterId));
  const candidates = new Set();
  for (const token of queryTokens) {
    for (const chunkId of index[token] || []) candidates.add(chunkId);
  }
  if (currentSceneId) {
    for (const chunk of filtered) if (chunk.sceneId === currentSceneId) candidates.add(chunk.id);
  }

  const total = Math.max(1, filtered.length);
  const df = new Map();
  for (const token of queryTokens) df.set(token, (index[token] || []).length || 1);

  const scored = [];
  for (const chunk of filtered) {
    if (!candidates.has(chunk.id) && chunk.sceneId !== currentSceneId) continue;
    const haystack = `${chunk.title || ''}\n${chunk.text || ''}\n${(chunk.keywords || []).join(' ')}`;
    const tokens = tokenize(haystack);
    let score = 0;
    for (const token of queryTokens) {
      const tf = countToken(tokens, token);
      if (!tf) continue;
      const idf = Math.log((total + 1) / (df.get(token) || 1)) + 1;
      score += tf * idf;
    }
    if (chunk.sceneId === currentSceneId) score += 6;
    if (chunk.title && query && query.includes(chunk.title)) score += 3;
    if (score > 0) scored.push({ ...chunk, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, Math.max(1, Math.min(10, Number(topK) || 4)));

  // 当前场景至少保留一个分块，避免检索完全错位。
  if (currentSceneId && !selected.some((chunk) => chunk.sceneId === currentSceneId)) {
    const current = filtered.find((chunk) => chunk.sceneId === currentSceneId);
    if (current) selected.unshift({ ...current, score: 0.1 });
  }

  return selected.slice(0, Math.max(1, Math.min(10, Number(topK) || 4)));
}

/* =========================================================
 * 模组查询与编辑辅助
 * ========================================================= */

export function flattenScenes(module) {
  const result = [];
  for (const chapter of module?.structure?.chapters || []) {
    for (const scene of chapter.scenes || []) {
      result.push({ chapter, scene });
    }
  }
  return result;
}

export function findScene(module, sceneId) {
  return flattenScenes(module).find((item) => item.scene.id === sceneId) || null;
}

export function findChapterByScene(module, sceneId) {
  return flattenScenes(module).find((item) => item.scene.id === sceneId)?.chapter || null;
}

export function moduleStats(module) {
  const chapters = module?.structure?.chapters || [];
  const scenes = flattenScenes(module);
  return {
    chapters: chapters.length,
    scenes: scenes.length,
    clues: module?.clues?.length || 0,
    npcs: module?.npcs?.length || 0,
    events: module?.events?.length || 0,
    roles: module?.roles?.length || 0,
    chunks: module?.chunks?.length || 0,
    keywords: Object.keys(module?.retrieval?.index || {}).length,
  };
}

export function toggleKeyClue(module, clueId) {
  const clue = (module.clues || []).find((item) => item.id === clueId);
  if (!clue) return false;
  clue.isKey = !clue.isKey;
  module.updatedAt = nowIso();
  return clue.isKey;
}

export function setEventMustTrigger(module, eventId, value) {
  const event = (module.events || []).find((item) => item.id === eventId);
  if (!event) return false;
  event.mustTrigger = Boolean(value);
  module.updatedAt = nowIso();
  return event.mustTrigger;
}

export function setSceneKey(module, sceneId, value) {
  const found = findScene(module, sceneId);
  if (!found) return false;
  found.scene.isKeyScene = Boolean(value);
  module.updatedAt = nowIso();
  return found.scene.isKeyScene;
}

/**
 * 将场景内容按段落重新分块，供手动修正切分后重建索引。
 */
export function rebuildChunks(module) {
  const chunks = [];
  const counters = { chunk: 0 };
  for (const chapter of module.structure?.chapters || []) {
    for (const scene of chapter.scenes || []) {
      const text = [scene.readAloud, scene.content].filter(Boolean).join('\n\n');
      for (const piece of splitIntoChunks(text)) {
        chunks.push({
          id: createId('chunk', ++counters.chunk),
          title: scene.title,
          chapterId: chapter.id,
          sceneId: scene.id,
          text: piece,
          keywords: extractKeywords(`${scene.title}\n${piece}`, 16),
          tokenEstimate: Math.ceil(piece.length / 2),
          order: chunks.length,
          mustNotLeakBeforeUnlock: true,
        });
      }
      scene.clueIds = (module.clues || []).filter((clue) => clue.sceneId === scene.id).map((clue) => clue.id);
      scene.npcIds = (module.npcs || []).filter((npc) => (npc.sceneIds || []).includes(scene.id)).map((npc) => npc.id);
      scene.eventIds = (module.events || []).filter((event) => event.sceneId === scene.id).map((event) => event.id);
    }
  }
  module.chunks = chunks;
  buildRetrievalIndex(module);
  module.updatedAt = nowIso();
  return module;
}

export function moduleToMarkdown(module) {
  return `# ${module.title}

> ${module.description || '无简介'}

${
  module.roles?.length
    ? `## HO 身份\n\n${module.roles
        .map(
          (role) =>
            `### ${role.code}：${role.title}\n\n${role.publicInfo || role.summary || ''}${
              role.privateInfo ? `\n\n**私密信息**：${role.privateInfo}` : ''
            }`
        )
        .join('\n\n')}`
    : ''
}

${(module.structure?.chapters || [])
  .map(
    (chapter) =>
      `## ${chapter.title}\n\n${chapter.summary || ''}\n\n${(chapter.scenes || [])
        .map(
          (scene) =>
            `### ${scene.title}\n\n${scene.readAloud ? `> ${scene.readAloud}\n\n` : ''}${scene.content || ''}`
        )
        .join('\n\n')}`
  )
  .join('\n\n')}`;
}

export const moduleEngine = Object.freeze({
  parseModuleFile,
  buildRetrievalIndex,
  retrieveChunks,
  tokenize,
  extractKeywords,
  splitIntoChunks,
  flattenScenes,
  findScene,
  findChapterByScene,
  moduleStats,
  toggleKeyClue,
  setEventMustTrigger,
  setSceneKey,
  rebuildChunks,
  moduleToMarkdown,
});

export default moduleEngine;
