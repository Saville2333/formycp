/**
 * character.js — CoC 7e 角色规则引擎、职业模板与 AI 车卡
 *
 * 本文件只负责“规则与数据”，不直接操作 DOM。
 *
 * 规则出处：
 * -《克苏鲁的呼唤》第七版核心规则书 · 第三章「创建调查员」
 * - 属性：STR/CON/DEX/APP/POW = 3D6×5；SIZ/INT/EDU = (2D6+6)×5
 * - 幸运：3D6×5；15–19 岁掷两次取高
 * - HP = ⌊(CON+SIZ)/10⌋；MP = ⌊POW/5⌋；SAN = POW（上限 99）
 * - MOV：STR 与 DEX 均 < SIZ → 7；任一 ≥ SIZ → 8；两者均 > SIZ → 9
 * - 年龄修正与 DB / Build 查表见文件内注释
 * - 职业点 = EDU×2；兴趣点 = INT×2；信用评级必须在职业区间
 */

import { rollDie, systemRng } from './dice.js';

export const CHARACTER_SCHEMA_VERSION = 1;

export const ATTRIBUTE_META = [
  { key: 'str', abbr: 'STR', label: '力量', formula: '3D6 × 5' },
  { key: 'con', abbr: 'CON', label: '体质', formula: '3D6 × 5' },
  { key: 'siz', abbr: 'SIZ', label: '体型', formula: '(2D6 + 6) × 5' },
  { key: 'dex', abbr: 'DEX', label: '敏捷', formula: '3D6 × 5' },
  { key: 'app', abbr: 'APP', label: '外貌', formula: '3D6 × 5' },
  { key: 'int', abbr: 'INT', label: '智力', formula: '(2D6 + 6) × 5' },
  { key: 'pow', abbr: 'POW', label: '意志', formula: '3D6 × 5' },
  { key: 'edu', abbr: 'EDU', label: '教育', formula: '(2D6 + 6) × 5' },
];

export const ATTRIBUTE_KEYS = ATTRIBUTE_META.map((attribute) => attribute.key);

/**
 * 年龄修正表。
 * 15–19：STR/CON/DEX/APP/EDU −5，幸运骰两次取高。
 * 40–49：−5，EDU +5，MOV −1。
 * 50–59：−10，EDU +10，MOV −2。
 * 60–69：−20，EDU +20，MOV −3。
 * 70–79：−40，EDU +40，MOV −4。
 * 80+：−80，EDU +80，MOV −5。
 */
export const AGE_TABLE = Object.freeze({
  '15-19': { str: -5, con: -5, dex: -5, app: -5, edu: -5, mov: 0, luckRolls: 2 },
  '20-39': { str: 0, con: 0, dex: 0, app: 0, edu: 0, mov: 0, luckRolls: 1 },
  '40-49': { str: -5, con: -5, dex: -5, app: -5, edu: 5, mov: -1, luckRolls: 1 },
  '50-59': { str: -10, con: -10, dex: -10, app: -10, edu: 10, mov: -2, luckRolls: 1 },
  '60-69': { str: -20, con: -20, dex: -20, app: -20, edu: 20, mov: -3, luckRolls: 1 },
  '70-79': { str: -40, con: -40, dex: -40, app: -40, edu: 40, mov: -4, luckRolls: 1 },
  '80-120': { str: -80, con: -80, dex: -80, app: -80, edu: 80, mov: -5, luckRolls: 1 },
});

export function ageBracket(age) {
  const value = Math.floor(Number(age) || 0);
  if (value <= 19) return '15-19';
  if (value <= 39) return '20-39';
  if (value <= 49) return '40-49';
  if (value <= 59) return '50-59';
  if (value <= 69) return '60-69';
  if (value <= 79) return '70-79';
  return '80-120';
}

/**
 * 常见技能基础值。未收录的自定义技能以 1 为基础。
 * 闪避与母语依赖属性，在 baseSkillValue 中单独计算。
 */
export const SKILL_BASE = Object.freeze({
  会计: 5,
  人类学: 1,
  估价: 5,
  考古学: 1,
  艺术: 5,
  摄影: 5,
  话术: 5,
  攀爬: 20,
  信用评级: 0,
  克苏鲁神话: 0,
  乔装: 5,
  闪避: 0,
  驾驶: 20,
  电气维修: 10,
  电子学: 1,
  历史: 5,
  急救: 30,
  恐吓: 15,
  跳跃: 20,
  法律: 5,
  图书馆使用: 20,
  聆听: 20,
  锁匠: 1,
  机械维修: 10,
  医学: 1,
  博物学: 10,
  导航: 10,
  神秘学: 5,
  操作重型机械: 1,
  说服: 10,
  心理学: 10,
  心理分析: 1,
  骑术: 5,
  科学: 1,
  妙手: 10,
  侦查: 25,
  潜行: 20,
  生存: 10,
  游泳: 20,
  投掷: 20,
  追踪: 10,
  潜水: 1,
  爆破: 1,
  炮术: 1,
  斗殴: 25,
  '射击（手枪）': 20,
  '射击（步枪/霰弹枪）': 25,
});

/**
 * 内置职业模板。技能点按本项目统一口径 EDU×2。
 * 信用评级区间来自职业条目，实际车卡时由 KP 与调查员协商。
 */
export const OCCUPATIONS = Object.freeze([
  {
    id: 'detective',
    name: '私家侦探',
    description: '在城市的阴影里替人寻找答案，也替自己寻找麻烦。',
    skills: ['侦查', '图书馆使用', '心理学', '说服', '话术', '潜行', '射击（手枪）', '法律', '聆听', '闪避'],
    creditRange: [20, 50],
  },
  {
    id: 'reporter',
    name: '记者',
    description: '相信真相值得被写下来，哪怕它正在看着你。',
    skills: ['侦查', '图书馆使用', '说服', '心理学', '话术', '摄影', '历史', '聆听', '母语', '闪避'],
    creditRange: [10, 40],
  },
  {
    id: 'doctor',
    name: '医生',
    description: '在血肉与病历之间，偶尔会看到不属于医学的东西。',
    skills: ['医学', '急救', '心理分析', '生物学', '药剂学', '拉丁语', '心理学', '聆听', '说服', '闪避'],
    creditRange: [30, 70],
  },
  {
    id: 'professor',
    name: '教授',
    description: '知识是灯火，也是通往黑暗的邀请函。',
    skills: ['图书馆使用', '历史', '心理学', '说服', '拉丁语', '考古学', '人类学', '神秘学', '母语', '闪避'],
    creditRange: [20, 60],
  },
  {
    id: 'priest',
    name: '神父',
    description: '听过太多忏悔，于是知道有些罪并不属于人类。',
    skills: ['说服', '心理学', '历史', '图书馆使用', '聆听', '拉丁语', '神秘学', '急救', '母语', '闪避'],
    creditRange: [10, 40],
  },
  {
    id: 'antiquarian',
    name: '古董商',
    description: '经手过许多旧物，偶尔也经手不该被买卖的东西。',
    skills: ['估价', '历史', '图书馆使用', '侦查', '会计', '说服', '神秘学', '驾驶', '母语', '闪避'],
    creditRange: [30, 70],
  },
  {
    id: 'police',
    name: '警察',
    description: '见过人性的底线，也见过底线之外的东西。',
    skills: ['侦查', '法律', '闪避', '射击（手枪）', '恐吓', '聆听', '心理学', '驾驶', '急救', '斗殴'],
    creditRange: [10, 40],
  },
  {
    id: 'gangster',
    name: '黑帮成员',
    description: '在秩序之外谋生，却比任何人都在意自己的地盘。',
    skills: ['恐吓', '潜行', '射击（手枪）', '斗殴', '闪避', '侦查', '说服', '驾驶', '估价', '聆听'],
    creditRange: [5, 30],
  },
  {
    id: 'artist',
    name: '艺术家',
    description: '把看见的东西画下来，哪怕没有人相信你看见了。',
    skills: ['艺术', '历史', '图书馆使用', '侦查', '说服', '心理学', '摄影', '神秘学', '母语', '闪避'],
    creditRange: [5, 30],
  },
  {
    id: 'custom',
    name: '自定义职业',
    description: '由 KP 与调查员共同确定本职技能与信用评级区间。',
    skills: [],
    creditRange: [0, 99],
  },
]);

export class CharacterError extends Error {
  constructor(message, { code = 'CHARACTER_ERROR', details = [] } = {}) {
    super(message);
    this.name = 'CharacterError';
    this.code = code;
    this.details = details;
  }
}

/* =========================================================
 * 属性、年龄与派生值
 * ========================================================= */

export function roll3d6x5(rng = systemRng) {
  return (rollDie(6, rng) + rollDie(6, rng) + rollDie(6, rng)) * 5;
}

export function roll2d6plus6x5(rng = systemRng) {
  return (rollDie(6, rng) + rollDie(6, rng) + 6) * 5;
}

export function rollLuck(age = 30, rng = systemRng) {
  const bracket = ageBracket(age);
  const rolls = AGE_TABLE[bracket].luckRolls;
  let best = 0;
  for (let index = 0; index < rolls; index += 1) {
    best = Math.max(best, roll3d6x5(rng));
  }
  return best;
}

export function rollAttributes({ age = 30, rng = systemRng } = {}) {
  const raw = {
    str: roll3d6x5(rng),
    con: roll3d6x5(rng),
    siz: roll2d6plus6x5(rng),
    dex: roll3d6x5(rng),
    app: roll3d6x5(rng),
    int: roll2d6plus6x5(rng),
    pow: roll3d6x5(rng),
    edu: roll2d6plus6x5(rng),
  };
  const luck = rollLuck(age, rng);
  const adjusted = applyAgeAdjustments(raw, age);
  return {
    raw,
    luck,
    ...adjusted,
  };
}

/**
 * 应用年龄修正。属性最终限制在 1–99。
 * 返回的 movPenalty 需要从基础 MOV 中扣除。
 */
export function applyAgeAdjustments(attributes, age) {
  const bracket = ageBracket(age);
  const modifiers = AGE_TABLE[bracket];
  const result = {};
  for (const key of ATTRIBUTE_KEYS) {
    const base = Math.floor(Number(attributes?.[key]) || 0);
    result[key] = Math.max(1, Math.min(99, base + (modifiers[key] || 0)));
  }
  return {
    attributes: result,
    rawAttributes: { ...attributes },
    ageBracket: bracket,
    adjustments: {
      str: modifiers.str,
      con: modifiers.con,
      dex: modifiers.dex,
      app: modifiers.app,
      edu: modifiers.edu,
      mov: modifiers.mov,
    },
    movPenalty: Math.abs(modifiers.mov),
  };
}

/** DB / Build 查表；超过 524 后每增加 80 点，DB +1D6、Build +1。 */
export function damageBonusAndBuild(str, siz) {
  const total = Math.max(0, Math.floor(Number(str) || 0) + Math.floor(Number(siz) || 0));
  if (total <= 64) return { total, db: '-2', build: -2 };
  if (total <= 84) return { total, db: '-1', build: -1 };
  if (total <= 124) return { total, db: '0', build: 0 };
  if (total <= 164) return { total, db: '+1D4', build: 1 };
  if (total <= 204) return { total, db: '+1D6', build: 2 };
  if (total <= 284) return { total, db: '+2D6', build: 3 };
  if (total <= 364) return { total, db: '+3D6', build: 4 };
  if (total <= 444) return { total, db: '+4D6', build: 5 };
  if (total <= 524) return { total, db: '+5D6', build: 6 };
  const extra = Math.floor((total - 525) / 80) + 1;
  return {
    total,
    db: `+${5 + extra}D6`,
    build: 6 + extra,
  };
}

/** 基础 MOV：STR/DEX 均 < SIZ → 7；任一 ≥ SIZ → 8；两者均 > SIZ → 9。 */
export function baseMovement(attributes) {
  const str = Number(attributes?.str) || 0;
  const dex = Number(attributes?.dex) || 0;
  const siz = Number(attributes?.siz) || 0;
  if (str > siz && dex > siz) return 9;
  if (str < siz && dex < siz) return 7;
  return 8;
}

export function calculateDerived(attributes, age = 30) {
  const str = Math.max(1, Number(attributes?.str) || 0);
  const con = Math.max(1, Number(attributes?.con) || 0);
  const siz = Math.max(1, Number(attributes?.siz) || 0);
  const pow = Math.max(1, Number(attributes?.pow) || 0);
  const { movPenalty } = applyAgeAdjustments(attributes, age);
  const { total, db, build } = damageBonusAndBuild(str, siz);
  const hpMax = Math.floor((con + siz) / 10);
  const mpMax = Math.floor(pow / 5);
  return {
    hp: { current: hpMax, max: hpMax },
    mp: { current: mpMax, max: mpMax },
    san: { current: Math.min(99, pow), max: 99 },
    mov: Math.max(0, baseMovement(attributes) - movPenalty),
    db,
    build,
    strSiz: total,
  };
}

export function baseSkillValue(name, attributes) {
  if (name === '闪避') return Math.floor((Number(attributes?.dex) || 0) / 2);
  if (name === '母语') return Math.max(0, Math.floor(Number(attributes?.edu) || 0));
  return SKILL_BASE[name] ?? 1;
}

/* =========================================================
 * 职业与技能
 * ========================================================= */

export function getOccupation(id) {
  return OCCUPATIONS.find((occupation) => occupation.id === id) || OCCUPATIONS[0];
}

export function occupationOptions() {
  return OCCUPATIONS.map(({ id, name }) => ({ id, name }));
}

export function occupationSkillSet(occupation) {
  // 信用评级不列在职业条目里，但它始终使用职业点，是最常见的例外。
  return new Set(['信用评级', ...(occupation?.skills || [])]);
}

/**
 * 为职业生成技能列表。保留已有分配，新增技能以基础值起步。
 */
export function createSkillList(occupationId, attributes, existing = []) {
  const occupation = getOccupation(occupationId);
  const names = [...new Set(['母语', '闪避', '信用评级', ...occupation.skills])];
  const existingMap = new Map((existing || []).map((skill) => [skill.name, skill]));
  return names.map((name) => {
    const base = baseSkillValue(name, attributes);
    const old = existingMap.get(name);
    return {
      name,
      base,
      occupation: old ? Math.max(0, Number(old.occupation) || 0) : 0,
      interest: old ? Math.max(0, Number(old.interest) || 0) : 0,
      total: old
        ? base + Math.max(0, Number(old.occupation) || 0) + Math.max(0, Number(old.interest) || 0)
        : base,
      checked: Boolean(old?.checked),
    };
  });
}

export function createDraft({
  kind = 'pc',
  occupationId = 'detective',
  age = 30,
  attributes = null,
  name = '',
} = {}) {
  const finalAttributes =
    attributes ||
    Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, key === 'siz' || key === 'int' || key === 'edu' ? 60 : 50]));
  const occupation = getOccupation(occupationId);
  const creditRating = Math.round((occupation.creditRange[0] + occupation.creditRange[1]) / 2);
  const derived = calculateDerived(finalAttributes, age);
  return {
    id: '',
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    kind,
    name,
    age,
    gender: '',
    occupation: occupation.name,
    occupationId: occupation.id,
    nationality: '中国',
    appearance: '',
    heightCm: 170,
    weightKg: 60,
    personality: [],
    catchphrase: '',
    background: '',
    joinReason: '',
    importantPerson: '',
    ideology: '',
    significantPlace: '',
    treasuredItem: '',
    traits: '',
    phobias: '',
    motherTongue: '中文',
    languages: [{ name: '英语', level: 30 }],
    possessions: [],
    attributes: { ...finalAttributes },
    luck: 50,
    derived,
    skills: createSkillList(occupation.id, finalAttributes).map((skill) =>
      skill.name === '信用评级' ? { ...skill, occupation: creditRating, total: creditRating } : skill
    ),
    creditRating,
    occupationPoints: finalAttributes.edu * 2,
    interestPoints: finalAttributes.int * 2,
    pointsSpent: { occupation: 0, interest: 0 },
    notes: '',
    detailedSetting: '',
    memories: [],
    portrait: null,
  };
}

export function skillTotal(skill) {
  return (
    Math.max(0, Math.floor(Number(skill.base) || 0)) +
    Math.max(0, Math.floor(Number(skill.occupation) || 0)) +
    Math.max(0, Math.floor(Number(skill.interest) || 0))
  );
}

export function recalculateSkill(skill) {
  return { ...skill, total: skillTotal(skill) };
}

/* =========================================================
 * 严格校验
 * ========================================================= */

export function validateBuild(build) {
  const errors = [];
  const warnings = [];
  const occupation = getOccupation(build?.occupationId || 'detective');
  const attributes = build?.attributes || {};
  const age = Math.floor(Number(build?.age) || 0);

  if (!build || typeof build !== 'object') {
    return { valid: false, errors: ['角色数据必须是一个对象。'], warnings, totals: null, occupation };
  }
  if (!Number.isInteger(age) || age < 15 || age > 120) {
    errors.push('年龄必须在 15–120 之间。');
  }
  for (const key of ATTRIBUTE_KEYS) {
    const value = Number(attributes[key]);
    if (!Number.isInteger(value) || value < 1 || value > 99) {
      errors.push(`${key.toUpperCase()} 必须是 1–99 的整数。`);
    }
  }
  const luck = Number(build.luck);
  if (!Number.isInteger(luck) || luck < 0 || luck > 99) {
    errors.push('幸运必须是 0–99 的整数。');
  }

  const edu = Math.max(0, Number(attributes.edu) || 0);
  const int = Math.max(0, Number(attributes.int) || 0);
  const occupationBudget = edu * 2;
  const interestBudget = int * 2;
  const occupationSkills = occupationSkillSet(occupation);
  const skills = Array.isArray(build.skills) ? build.skills : [];
  const seen = new Set();
  let occupationSpent = 0;
  let interestSpent = 0;
  let creditSkill = null;

  if (!skills.length) errors.push('至少需要一项技能。');

  for (const rawSkill of skills) {
    const name = String(rawSkill?.name || '').trim();
    if (!name) {
      errors.push('技能名称不能为空。');
      continue;
    }
    if (seen.has(name)) {
      errors.push(`技能「${name}」重复出现。`);
      continue;
    }
    seen.add(name);

    const base = Number.isFinite(Number(rawSkill.base))
      ? Math.floor(Number(rawSkill.base))
      : baseSkillValue(name, attributes);
    const occupationPoints = Math.max(0, Math.floor(Number(rawSkill.occupation) || 0));
    const interestPoints = Math.max(0, Math.floor(Number(rawSkill.interest) || 0));
    const total = base + occupationPoints + interestPoints;

    if (base < 0 || occupationPoints < 0 || interestPoints < 0) {
      errors.push(`技能「${name}」的点数不能为负数。`);
    }
    if (total > 99) {
      errors.push(`技能「${name}」总计 ${total} 超过 CoC 七版上限 99。`);
    }
    if (occupationPoints > 0 && occupation.id !== 'custom' && !occupationSkills.has(name)) {
      errors.push(`技能「${name}」不是「${occupation.name}」的本职技能，不能使用职业点。`);
    }
    if (occupationPoints > 0) occupationSpent += occupationPoints;
    if (interestPoints > 0) interestSpent += interestPoints;
    if (name === '信用评级') creditSkill = total;
  }

  let creditRating = Number(build.creditRating);
  if (!Number.isFinite(creditRating) && creditSkill !== null) creditRating = creditSkill;
  creditRating = Math.round(Number(creditRating) || 0);
  if (creditRating < occupation.creditRange[0] || creditRating > occupation.creditRange[1]) {
    errors.push(
      `信用评级 ${creditRating} 不在「${occupation.name}」允许区间 ${occupation.creditRange[0]}–${occupation.creditRange[1]} 内。`
    );
  }
  if (creditSkill !== null && Math.round(creditSkill) !== creditRating) {
    errors.push(`信用评级字段 ${creditRating} 与技能「信用评级」${creditSkill} 不一致。`);
  }
  if (creditSkill === null) {
    // 信用评级必须计入职业点；如果调用方只给了 creditRating，前端会自动补一条技能。
    warnings.push('技能列表缺少「信用评级」，保存时会自动补入。');
  }

  if (occupationSpent > occupationBudget) {
    errors.push(`职业点超额：已用 ${occupationSpent}，预算 ${occupationBudget}（EDU × 2）。`);
  }
  if (interestSpent > interestBudget) {
    errors.push(`兴趣点超额：已用 ${interestSpent}，预算 ${interestBudget}（INT × 2）。`);
  }
  if (occupationSpent < occupationBudget) {
    warnings.push(`职业点剩余 ${occupationBudget - occupationSpent} 点。`);
  }
  if (interestSpent < interestBudget) {
    warnings.push(`兴趣点剩余 ${interestBudget - interestSpent} 点。`);
  }

  const derived = calculateDerived(attributes, age);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    occupation,
    attributes,
    derived,
    creditRating,
    totals: {
      occupationBudget,
      interestBudget,
      occupationSpent,
      interestSpent,
      occupationRemaining: Math.max(0, occupationBudget - occupationSpent),
      interestRemaining: Math.max(0, interestBudget - interestSpent),
    },
  };
}

/**
 * 将规则校验通过的 build 写成完整角色卡（保留人设字段）。
 * 当前 HP/MP/SAN 都是满值，适合新建角色。
 */
export function applyBuildToCharacter(draft, build) {
  const occupation = getOccupation(build.occupationId || draft.occupationId);
  const derived = calculateDerived(build.attributes, build.age);
  const skills = (build.skills || []).map((skill) => {
    const base = Number.isFinite(Number(skill.base))
      ? Math.floor(Number(skill.base))
      : baseSkillValue(skill.name, build.attributes);
    return recalculateSkill({
      name: String(skill.name).trim(),
      base,
      occupation: Math.max(0, Math.floor(Number(skill.occupation) || 0)),
      interest: Math.max(0, Math.floor(Number(skill.interest) || 0)),
      checked: Boolean(skill.checked),
    });
  });

  return {
    ...draft,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    kind: draft.kind === 'npc' ? 'npc' : 'pc',
    age: Math.floor(Number(build.age) || 30),
    occupation: occupation.name,
    occupationId: occupation.id,
    attributes: { ...build.attributes },
    luck: Math.floor(Number(build.luck) || 0),
    derived,
    skills,
    creditRating: Math.floor(Number(build.creditRating) || 0),
    occupationPoints: Math.max(0, Number(build.attributes.edu) || 0) * 2,
    interestPoints: Math.max(0, Number(build.attributes.int) || 0) * 2,
    pointsSpent: {
      occupation: skills.reduce((sum, skill) => sum + skill.occupation, 0),
      interest: skills.reduce((sum, skill) => sum + skill.interest, 0),
    },
    notes: draft.notes || '',
  };
}

/**
 * 随机骰点：只生成属性与派生值，保留草稿的其他人设字段。
 * 年龄修正已经应用。
 */
export function randomizeDraft(draft, { rng = systemRng } = {}) {
  const rolled = rollAttributes({ age: draft.age, rng });
  const derived = calculateDerived(rolled.attributes, draft.age);
  const occupation = getOccupation(draft.occupationId);
  const creditRating = Math.round((occupation.creditRange[0] + occupation.creditRange[1]) / 2);
  const skills = createSkillList(occupation.id, rolled.attributes, draft.skills || []).map((skill) =>
    skill.name === '信用评级'
      ? { ...skill, occupation: creditRating, interest: 0, total: creditRating }
      : { ...skill, occupation: 0, interest: 0, total: skill.base }
  );
  return {
    ...draft,
    attributes: rolled.attributes,
    rawAttributes: rolled.raw,
    luck: rolled.luck,
    ageBracket: rolled.ageBracket,
    movPenalty: rolled.movPenalty,
    derived,
    creditRating,
    occupationPoints: rolled.attributes.edu * 2,
    interestPoints: rolled.attributes.int * 2,
    skills,
  };
}

/* =========================================================
 * Markdown 导出
 * ========================================================= */

function markdownValue(value, fallback = '未填写') {
  if (Array.isArray(value)) return value.length ? value.join('、') : fallback;
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function characterToMarkdown(character) {
  const attributes = character.attributes || {};
  const derived = character.derived || {};
  const skills = character.skills || [];
  const languages = (character.languages || [])
    .map((language) => `${language.name} ${language.level}%`)
    .join('、');
  return `# ${character.name}

> ${character.occupation || '职业未填写'} · ${character.age || '?'} 岁 · ${character.gender || '未填写'} · ${character.nationality || '未填写'}

## 人物轮廓

- **外貌**：${markdownValue(character.appearance)}
- **身高 / 体重**：${character.heightCm || '—'} cm / ${character.weightKg || '—'} kg
- **性格关键词**：${markdownValue(character.personality)}
- **口头禅**：“${markdownValue(character.catchphrase)}”

## 背景与动机

- **背景故事**：${markdownValue(character.background)}
- **加入调查的原因**：${markdownValue(character.joinReason)}
- **重要之人**：${markdownValue(character.importantPerson)}
- **信念 / 理念**：${markdownValue(character.ideology)}
- **意义非凡之地**：${markdownValue(character.significantPlace)}
- **宝贵之物**：${markdownValue(character.treasuredItem)}
- **特质 / 缺陷**：${markdownValue(character.traits)}
- **恐惧症 / 狂躁症**：${markdownValue(character.phobias)}

## 属性

| STR | CON | SIZ | DEX | APP | INT | POW | EDU | LUCK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${attributes.str ?? '—'} | ${attributes.con ?? '—'} | ${attributes.siz ?? '—'} | ${attributes.dex ?? '—'} | ${attributes.app ?? '—'} | ${attributes.int ?? '—'} | ${attributes.pow ?? '—'} | ${attributes.edu ?? '—'} | ${character.luck ?? '—'} |

- **HP**：${derived.hp?.current ?? '—'} / ${derived.hp?.max ?? '—'}
- **MP**：${derived.mp?.current ?? '—'} / ${derived.mp?.max ?? '—'}
- **SAN**：${derived.san?.current ?? '—'} / ${derived.san?.max ?? '—'}
- **MOV**：${derived.mov ?? '—'}
- **DB**：${derived.db ?? '—'}
- **Build**：${derived.build ?? '—'}
- **信用评级**：${character.creditRating ?? '—'}

## 技能

| 技能 | 基础 | 职业 | 兴趣 | 总计 |
| --- | ---: | ---: | ---: | ---: |
${skills.map((skill) => `| ${skill.name} | ${skill.base} | ${skill.occupation} | ${skill.interest} | ${skill.total} |`).join('\n')}

## 语言与物品

- **母语**：${markdownValue(character.motherTongue)}
- **其他语言**：${markdownValue(languages)}
- **随身物品**：${markdownValue(character.possessions)}

## 详细角色设定

${markdownValue(character.detailedSetting)}

## 角色记忆

${
  character.memories?.length
    ? character.memories
        .map(
          (memory) =>
            `### ${memory.moduleTitle || '未命名模组'}\n\n${memory.summary}${
              memory.keyEvents?.length ? `\n\n关键事件：${memory.keyEvents.join('；')}` : ''
            }`
        )
        .join('\n\n')
    : '暂无跨模组记忆。'
}

## 备注

${markdownValue(character.notes)}
`;
}

/* =========================================================
 * AI 自动车卡
 * ========================================================= */

export const AI_BUILD_JSON_SCHEMA = Object.freeze({
  type: 'object',
  required: ['attributes', 'luck', 'creditRating', 'skills'],
  properties: {
    attributes: {
      type: 'object',
      required: ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'],
      properties: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, { type: 'integer', minimum: 1, maximum: 99 }])),
      additionalProperties: false,
    },
    luck: { type: 'integer', minimum: 0, maximum: 99 },
    creditRating: { type: 'integer', minimum: 0, maximum: 99 },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'occupation', 'interest'],
        properties: {
          name: { type: 'string' },
          occupation: { type: 'integer', minimum: 0 },
          interest: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    rationale: { type: 'string' },
  },
  additionalProperties: false,
});

function personaText(persona) {
  const labels = {
    name: '姓名',
    age: '年龄',
    gender: '性别',
    occupation: '职业',
    nationality: '国籍',
    appearance: '外貌',
    personality: '性格关键词',
    catchphrase: '口头禅',
    background: '背景故事',
    detailedSetting: '详细角色设定',
    joinReason: '加入调查的原因',
    importantPerson: '重要之人',
    ideology: '信念 / 理念',
    significantPlace: '意义非凡之地',
    treasuredItem: '宝贵之物',
    traits: '特质 / 缺陷',
    phobias: '恐惧症 / 狂躁症',
    motherTongue: '母语',
    languages: '其他语言',
    possessions: '随身物品',
  };
  return Object.entries(labels)
    .map(([key, label]) => {
      let value = persona?.[key];
      if (Array.isArray(value)) value = value.join('、');
      if (key === 'languages' && Array.isArray(persona?.languages)) {
        value = persona.languages.map((item) => `${item.name} ${item.level}%`).join('、');
      }
      return `- ${label}：${String(value ?? '').trim() || '未填写'}`;
    })
    .join('\n');
}

export function buildAutoCharacterMessages({ persona, occupationId, age }) {
  const occupation = getOccupation(occupationId);
  const modifier = AGE_TABLE[ageBracket(age)];
  return [
    {
      role: 'system',
      content: `你是《克苏鲁的呼唤》第七版（CoC 7e）的资深车卡助手。你的任务不是写小说，而是严格依据调查员人设，输出一份可直接被程序校验的 JSON。

硬性规则：
1. 属性是“年龄修正前”的原始骰点，必须符合：
   - STR/CON/DEX/APP/POW：3D6×5，取值 15–90，且为 5 的倍数。
   - SIZ/INT/EDU：(2D6+6)×5，取值 40–90，且为 5 的倍数。
   - LUCK 为 3D6×5，取值 15–90，且为 5 的倍数。
2. 年龄修正由程序完成，你不要在 attributes 中预先加减。当前年龄 ${age}，档位 ${ageBracket(age)}，修正为：
   STR ${modifier.str} / CON ${modifier.con} / DEX ${modifier.dex} / APP ${modifier.app} / EDU ${modifier.edu} / MOV ${modifier.mov}。
3. 职业固定为「${occupation.name}」。本职技能只可使用：${occupation.skills.join('、') || '由 KP 自定义'}。
4. 职业点为最终 EDU×2，兴趣点为最终 INT×2；信用评级必须位于 ${occupation.creditRange[0]}–${occupation.creditRange[1]}。
5. skills 中只填写额外分配点（occupation / interest），不要填写基础值，也不要填写 total；程序会加上基础值并校验。
6. 职业点只能分配给本职技能；兴趣点可以分配给任何合理技能。
7. 技能总计不得超过 99。信用评级也要作为一项技能输出，occupation 点数至少等于信用评级。
8. 必须把全部职业点和兴趣点分配完；不要虚报点数。
9. 只输出 JSON，不要 Markdown 代码围栏，不要解释文本。JSON 结构：
{
  "attributes": {"str":50,"con":55,"siz":60,"dex":50,"app":45,"int":65,"pow":55,"edu":70},
  "luck": 50,
  "creditRating": 30,
  "skills": [
    {"name":"侦查","occupation":40,"interest":0},
    {"name":"信用评级","occupation":30,"interest":0}
  ],
  "rationale": "一句话说明属性与技能为何契合人设"
}`,
    },
    {
      role: 'user',
      content: `调查员人设：
${personaText(persona)}

请依据以上人设输出严格 JSON。职业：${occupation.name}；年龄：${age}。`,
    },
  ];
}

function stripJsonFences(text) {
  const source = String(text ?? '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new CharacterError('模型没有返回 JSON 对象。', { code: 'AI_NOT_JSON' });
  }
  return candidate.slice(start, end + 1);
}

export function parseAIBuildResponse(text) {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch (error) {
    if (error instanceof CharacterError) throw error;
    throw new CharacterError(`AI 返回的 JSON 无法解析：${error.message}`, {
      code: 'AI_JSON_PARSE',
      details: [error.message],
    });
  }
}

/**
 * 校验 AI 的原始属性与技能分配，并生成最终 build。
 * AI 只输出原始属性；年龄修正、基础值、HP/MP/SAN/MOV/DB/Build 在这里计算。
 */
export function validateAIBuild(payload, { occupationId, age }) {
  const errors = [];
  const occupation = getOccupation(occupationId);
  const rawAttributes = payload?.attributes || {};

  const rawRanges = {
    str: [15, 90],
    con: [15, 90],
    siz: [40, 90],
    dex: [15, 90],
    app: [15, 90],
    int: [40, 90],
    pow: [15, 90],
    edu: [40, 90],
  };
  for (const key of ATTRIBUTE_KEYS) {
    const value = Number(rawAttributes[key]);
    const [min, max] = rawRanges[key];
    if (!Number.isInteger(value) || value < min || value > max || value % 5 !== 0) {
      errors.push(`${key.toUpperCase()} 必须是 ${min}–${max} 之间、且为 5 的倍数的原始骰点。`);
    }
  }

  const luck = Number(payload?.luck);
  if (!Number.isInteger(luck) || luck < 15 || luck > 90 || luck % 5 !== 0) {
    errors.push('LUCK 必须是 15–90 之间、且为 5 的倍数的原始骰点。');
  }

  const adjusted = applyAgeAdjustments(rawAttributes, age);
  const occupationBudget = adjusted.attributes.edu * 2;
  const interestBudget = adjusted.attributes.int * 2;
  const aiSkills = Array.isArray(payload?.skills) ? payload.skills : [];
  const occupationSkills = occupationSkillSet(occupation);
  const seen = new Set();
  let occupationSpent = 0;
  let interestSpent = 0;
  let creditFromSkill = null;

  if (!aiSkills.length) errors.push('skills 不能为空。');

  for (const rawSkill of aiSkills) {
    const name = String(rawSkill?.name || '').trim();
    if (!name) {
      errors.push('技能名不能为空。');
      continue;
    }
    if (seen.has(name)) {
      errors.push(`技能「${name}」重复出现。`);
      continue;
    }
    seen.add(name);
    const occupationPoints = Math.max(0, Math.floor(Number(rawSkill.occupation) || 0));
    const interestPoints = Math.max(0, Math.floor(Number(rawSkill.interest) || 0));

    if (!Number.isFinite(Number(rawSkill.occupation)) || !Number.isFinite(Number(rawSkill.interest))) {
      errors.push(`技能「${name}」的点数必须是数字。`);
    }
    if (occupationPoints > 0 && occupation.id !== 'custom' && !occupationSkills.has(name)) {
      errors.push(`「${name}」不是「${occupation.name}」的本职技能，不能分配职业点。`);
    }
    if (occupationPoints + interestPoints > 0) {
      const total = baseSkillValue(name, adjusted.attributes) + occupationPoints + interestPoints;
      if (total > 99) errors.push(`技能「${name}」总计 ${total} 超过 99。`);
    }
    occupationSpent += occupationPoints;
    interestSpent += interestPoints;
    if (name === '信用评级') creditFromSkill = occupationPoints || creditFromSkill;
  }

  let creditRating = Number(payload?.creditRating);
  if (!Number.isFinite(creditRating) && creditFromSkill !== null) creditRating = creditFromSkill;
  if (
    !Number.isInteger(creditRating) ||
    creditRating < occupation.creditRange[0] ||
    creditRating > occupation.creditRange[1]
  ) {
    errors.push(
      `信用评级必须是 ${occupation.creditRange[0]}–${occupation.creditRange[1]} 之间的整数。`
    );
  }
  if (creditFromSkill !== null && creditFromSkill !== creditRating) {
    errors.push('creditRating 与技能「信用评级」的数值必须一致。');
  }

  // 如果 AI 漏掉信用评级技能，则自动补入，并把它计入职业点。
  if (!seen.has('信用评级') && Number.isFinite(creditRating)) {
    aiSkills.push({ name: '信用评级', occupation: creditRating, interest: 0 });
    occupationSpent += creditRating;
    seen.add('信用评级');
  }

  if (occupationSpent > occupationBudget) {
    errors.push(`职业点超额：${occupationSpent} / ${occupationBudget}。`);
  }
  if (interestSpent > interestBudget) {
    errors.push(`兴趣点超额：${interestSpent} / ${interestBudget}。`);
  }
  if (occupationSpent !== occupationBudget) {
    errors.push(`职业点必须用满：${occupationSpent} / ${occupationBudget}。`);
  }
  if (interestSpent !== interestBudget) {
    errors.push(`兴趣点必须用满：${interestSpent} / ${interestBudget}。`);
  }

  const finalSkills = [
    ...new Map(
      [
        ...createSkillList(occupation.id, adjusted.attributes),
        ...aiSkills.map((skill) => ({
          name: String(skill.name).trim(),
          base: baseSkillValue(String(skill.name).trim(), adjusted.attributes),
          occupation: Math.max(0, Math.floor(Number(skill.occupation) || 0)),
          interest: Math.max(0, Math.floor(Number(skill.interest) || 0)),
          checked: false,
        })),
      ].map((skill) => {
        const ai = aiSkills.find((item) => String(item.name).trim() === skill.name);
        return [
          skill.name,
          recalculateSkill({
            ...skill,
            occupation: ai ? Math.max(0, Math.floor(Number(ai.occupation) || 0)) : 0,
            interest: ai ? Math.max(0, Math.floor(Number(ai.interest) || 0)) : 0,
          }),
        ];
      })
    ).values(),
  ];

  const build = {
    occupationId: occupation.id,
    age,
    attributes: adjusted.attributes,
    rawAttributes: { ...rawAttributes },
    luck,
    creditRating: Number.isInteger(creditRating) ? creditRating : 0,
    skills: finalSkills,
  };

  const ruleCheck = validateBuild(build);
  const allErrors = [...new Set([...errors, ...ruleCheck.errors])];
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: ruleCheck.warnings,
    build: {
      ...build,
      derived: adjusted.attributes ? calculateDerived(adjusted.attributes, age) : null,
    },
    adjusted,
    totals: {
      occupationBudget,
      interestBudget,
      occupationSpent,
      interestSpent,
    },
    occupation,
  };
}

/**
 * 调用 LLM 自动车卡。callModel 由调用方注入（通常为 api.complete）。
 * 校验失败时把错误反馈给模型重试，最多 maxRetries 次。
 */
export async function generateCharacterWithAI({
  persona,
  occupationId = 'detective',
  age = 30,
  callModel,
  maxRetries = 2,
  onAttempt,
} = {}) {
  if (typeof callModel !== 'function') {
    throw new CharacterError('缺少模型调用函数。', { code: 'MISSING_MODEL_CALL' });
  }
  const messages = buildAutoCharacterMessages({ persona, occupationId, age });
  let lastErrors = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (typeof onAttempt === 'function') onAttempt(attempt + 1, maxRetries + 1);
    const text = await callModel(messages, { attempt });
    try {
      const payload = parseAIBuildResponse(text);
      const validation = validateAIBuild(payload, { occupationId, age });
      if (validation.valid) {
        return {
          build: validation.build,
          validation,
          raw: payload,
          attempts: attempt + 1,
        };
      }
      lastErrors = validation.errors;
    } catch (error) {
      lastErrors = [error.message];
    }

    messages.push(
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `这份 JSON 未通过前端规则校验，请修正后重新输出完整 JSON。错误：\n- ${lastErrors.join(
          '\n- '
        )}\n注意：属性必须是年龄修正前的原始骰点；职业点/兴趣点必须用满；信用评级必须包含在 skills 中并计入职业点。`,
      }
    );
  }

  throw new CharacterError(`AI 车卡未通过校验（已尝试 ${maxRetries + 1} 次）。`, {
    code: 'AI_BUILD_INVALID',
    details: lastErrors,
  });
}

export const character = Object.freeze({
  ATTRIBUTE_META,
  ATTRIBUTE_KEYS,
  AGE_TABLE,
  OCCUPATIONS,
  SKILL_BASE,
  ageBracket,
  rollAttributes,
  applyAgeAdjustments,
  calculateDerived,
  damageBonusAndBuild,
  baseMovement,
  baseSkillValue,
  getOccupation,
  occupationOptions,
  createDraft,
  createSkillList,
  validateBuild,
  applyBuildToCharacter,
  randomizeDraft,
  characterToMarkdown,
  buildAutoCharacterMessages,
  validateAIBuild,
  generateCharacterWithAI,
});

export default character;
