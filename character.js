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

export const SKILL_CATEGORIES = Object.freeze([
  { id: 'explore', name: '探索与观察' },
  { id: 'social', name: '社交与交涉' },
  { id: 'knowledge', name: '知识与学问' },
  { id: 'medical', name: '医疗与精神' },
  { id: 'technical', name: '技术与操作' },
  { id: 'movement', name: '移动与生存' },
  { id: 'combat', name: '战斗' },
  { id: 'optional', name: '可选 / 扩展' },
]);

/**
 * 完整可选技能表。base 为未分配时的基础值。
 * detail 表示需要补子类（学科/语种/环境/载具/武器等），格式化为「技能（子类）」。
 */
export const SKILL_CATALOG = Object.freeze([
  // 探索与观察
  { category: 'explore', name: '侦查', base: 25, note: 'Spot Hidden' },
  { category: 'explore', name: '聆听', base: 20, note: 'Listen' },
  { category: 'explore', name: '图书馆使用', base: 20, note: 'Library Use' },
  { category: 'explore', name: '追踪', base: 10, note: 'Track' },
  { category: 'explore', name: '读唇', base: 1, note: 'Lip Reading，扩展' },
  { category: 'explore', name: '心理学', base: 10, note: 'Psychology' },

  // 社交与交涉
  { category: 'social', name: '取悦', base: 15, note: 'Charm' },
  { category: 'social', name: '话术', base: 5, note: 'Fast Talk' },
  { category: 'social', name: '说服', base: 10, note: 'Persuade' },
  { category: 'social', name: '恐吓', base: 15, note: 'Intimidate' },
  { category: 'social', name: '信用评级', base: 0, note: '不随使用成长' },
  { category: 'social', name: '乔装', base: 5, note: 'Disguise' },

  // 知识与学问
  { category: 'knowledge', name: '会计', base: 5, note: 'Accounting' },
  { category: 'knowledge', name: '人类学', base: 1, note: 'Anthropology' },
  { category: 'knowledge', name: '考古学', base: 1, note: 'Archaeology' },
  { category: 'knowledge', name: '历史', base: 5, note: 'History' },
  { category: 'knowledge', name: '法律', base: 5, note: 'Law' },
  { category: 'knowledge', name: '神秘学', base: 5, note: 'Occult' },
  { category: 'knowledge', name: '克苏鲁神话', base: 0, note: '特殊' },
  { category: 'knowledge', name: '博物学', base: 10, note: 'Natural World' },
  { category: 'knowledge', name: '科学', base: 1, detail: '学科', detailPlaceholder: '生物学', note: 'Science' },
  { category: 'knowledge', name: '生物学', base: 1, note: '科学子类' },
  { category: 'knowledge', name: '密码学', base: 1, note: '科学子类' },
  { category: 'knowledge', name: '气象学', base: 1, note: '科学子类' },
  { category: 'knowledge', name: '司法科学', base: 1, note: '科学子类，可选' },
  { category: 'knowledge', name: '药学', base: 1, note: '科学子类，可选' },
  { category: 'knowledge', name: '母语', base: 0, note: '基础值 = EDU' },
  { category: 'knowledge', name: '语言（其他）', base: 1, detail: '语种', detailPlaceholder: '拉丁语', detailMode: 'language', note: 'Language (Other)' },
  { category: 'knowledge', name: '拉丁语', base: 1, note: '语言子类' },
  { category: 'knowledge', name: '英语', base: 1, note: '语言子类' },
  { category: 'knowledge', name: '法语', base: 1, note: '语言子类' },
  { category: 'knowledge', name: '德语', base: 1, note: '语言子类' },

  // 医疗与精神
  { category: 'medical', name: '急救', base: 30, note: 'First Aid' },
  { category: 'medical', name: '医学', base: 1, note: 'Medicine' },
  { category: 'medical', name: '精神分析', base: 1, note: 'Psychoanalysis' },
  { category: 'medical', name: '心理分析', base: 1, note: '精神分析旧译名' },
  { category: 'medical', name: '催眠', base: 1, note: 'Hypnosis，扩展' },

  // 技术与操作
  { category: 'technical', name: '估价', base: 5, note: 'Appraise' },
  { category: 'technical', name: '技艺', base: 5, detail: '方向', detailPlaceholder: '绘画', note: 'Art & Craft' },
  { category: 'technical', name: '艺术', base: 5, note: '技艺子类' },
  { category: 'technical', name: '摄影', base: 5, note: '技艺子类' },
  { category: 'technical', name: '伪造', base: 5, note: '技艺子类' },
  { category: 'technical', name: '表演', base: 5, note: '技艺子类，可选' },
  { category: 'technical', name: '锁匠', base: 1, note: 'Locksmith' },
  { category: 'technical', name: '妙手', base: 10, note: 'Sleight of Hand' },
  { category: 'technical', name: '机械维修', base: 10, note: 'Mechanical Repair' },
  { category: 'technical', name: '电气维修', base: 10, note: 'Electrical Repair' },
  { category: 'technical', name: '电子学', base: 1, note: 'Electronics' },
  { category: 'technical', name: '计算机使用', base: 5, note: 'Computer Use' },
  { category: 'technical', name: '操作重型机械', base: 1, note: 'Operate Heavy Machinery' },
  { category: 'technical', name: '爆破', base: 1, note: 'Demolitions' },

  // 移动与生存
  { category: 'movement', name: '攀爬', base: 20, note: 'Climb' },
  { category: 'movement', name: '跳跃', base: 20, note: 'Jump' },
  { category: 'movement', name: '游泳', base: 20, note: 'Swim' },
  { category: 'movement', name: '潜水', base: 1, note: 'Scuba，扩展' },
  { category: 'movement', name: '潜行', base: 20, note: 'Stealth' },
  { category: 'movement', name: '生存', base: 10, detail: '环境', detailPlaceholder: '荒野', note: 'Survival' },
  { category: 'movement', name: '导航', base: 10, note: 'Navigate' },
  { category: 'movement', name: '汽车驾驶', base: 20, note: 'Drive Auto' },
  { category: 'movement', name: '驾驶', base: 20, note: 'Drive' },
  { category: 'movement', name: '驾驶（其他）', base: 1, detail: '载具类型', detailPlaceholder: '飞机', detailMode: 'vehicle', note: 'Pilot / 其他载具' },
  { category: 'movement', name: '骑术', base: 5, note: 'Ride' },
  { category: 'movement', name: '动物驯养', base: 5, note: 'Animal Handling' },
  { category: 'movement', name: '驯兽', base: 5, note: '动物驯养旧译' },

  // 战斗
  { category: 'combat', name: '闪避', base: 0, note: '基础值 = DEX/2' },
  { category: 'combat', name: '斗殴', base: 25, note: 'Fighting (Brawl)' },
  { category: 'combat', name: '格斗（斗殴）', base: 25, note: 'Fighting (Brawl)' },
  { category: 'combat', name: '格斗（剑）', base: 15, note: 'Fighting (Sword)' },
  { category: 'combat', name: '格斗（斧）', base: 15, note: 'Fighting (Axe)' },
  { category: 'combat', name: '格斗（矛）', base: 15, note: 'Fighting (Spear)' },
  { category: 'combat', name: '格斗（鞭）', base: 15, note: 'Fighting (Whip)' },
  { category: 'combat', name: '格斗（连枷）', base: 15, note: 'Fighting (Flail)' },
  { category: 'combat', name: '格斗（链锯）', base: 15, note: 'Fighting (Chainsaw)' },
  { category: 'combat', name: '格斗（小刀）', base: 15, note: 'Fighting (Knife)' },
  { category: 'combat', name: '格斗（擒抱）', base: 25, note: 'Fighting (Grapple)' },
  { category: 'combat', name: '格斗（其他）', base: 15, detail: '武器/流派', detailPlaceholder: '长棍', note: '自定义格斗' },
  { category: 'combat', name: '射击（手枪）', base: 20, note: 'Firearms (Handgun)' },
  { category: 'combat', name: '射击（步枪/霰弹枪）', base: 25, note: 'Firearms (Rifle/Shotgun)' },
  { category: 'combat', name: '射击（冲锋枪）', base: 15, note: '可选' },
  { category: 'combat', name: '射击（机枪）', base: 15, note: '可选' },
  { category: 'combat', name: '射击（弓）', base: 15, note: '可选' },
  { category: 'combat', name: '射击（十字弓）', base: 15, note: '可选' },
  { category: 'combat', name: '射击（重武器）', base: 10, note: '可选' },
  { category: 'combat', name: '射击（火焰喷射器）', base: 10, note: '可选' },
  { category: 'combat', name: '射击（其他）', base: 15, detail: '枪种', detailPlaceholder: '机枪', note: '自定义射击' },
  { category: 'combat', name: '投掷', base: 20, note: 'Throw' },
  { category: 'combat', name: '炮术', base: 1, note: 'Artillery，可选' },

  // 可选 / 扩展
  { category: 'optional', name: '冲锋枪', base: 15, note: '可替代「射击（冲锋枪）」' },
  { category: 'optional', name: '重武器', base: 10, note: '可选' },
  { category: 'optional', name: '火焰喷射器', base: 10, note: '可选' },
]);

/**
 * 常见技能基础值。未收录的自定义技能以 1 为基础。
 * 闪避与母语依赖属性，在 baseSkillValue 中单独计算。
 */
export const SKILL_BASE = Object.freeze(
  Object.fromEntries(SKILL_CATALOG.map((skill) => [skill.name, skill.base]))
);

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
  const key = String(name || '').trim();
  if (key === '闪避') return Math.floor((Number(attributes?.dex) || 0) / 2);
  if (key === '母语') return Math.max(0, Math.floor(Number(attributes?.edu) || 0));
  if (SKILL_BASE[key] !== undefined) return SKILL_BASE[key];
  // 带子类的技能：与目录中的基础技能保持同一基础值。
  if (key.startsWith('科学（')) return 1;
  if (key.startsWith('技艺（') || key.startsWith('艺术（')) return 5;
  if (key.startsWith('语言（')) return 1;
  if (key.startsWith('生存（')) return 10;
  if (key.startsWith('驾驶（')) return 1;
  if (key.startsWith('格斗（')) return /斗殴|擒抱|徒手/.test(key) ? 25 : 15;
  if (key.startsWith('射击（')) {
    if (/手枪/.test(key)) return 20;
    if (/步枪|霰弹|步\/霰/.test(key)) return 25;
    if (/重武器|火焰喷射器/.test(key)) return 10;
    return 15;
  }
  return 1;
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
          occupation: {
            type: 'integer',
            minimum: 0,
            description: '职业点目标值/权重；最终由前端按 EDU×2 总预算分配。',
          },
          interest: {
            type: 'integer',
            minimum: 0,
            description: '兴趣点目标值/权重；最终由前端按 INT×2 总预算分配。',
          },
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
   兴趣技能优先使用标准技能表；带子类的必须写全，例如「科学（生物学）」「语言（拉丁语）」「射击（手枪）」「格斗（剑）」「生存（荒野）」。标准技能表：${[
     ...new Set(SKILL_CATALOG.map((skill) => skill.name)),
   ].join('、')}。
4. 程序会先计算总预算：职业点 = 最终 EDU×2，兴趣点 = 最终 INT×2。技能分配不需要你手工凑满；程序会从总额出发精确分配。
5. skills 中的 occupation / interest 是“目标点数/相对权重”，不是最终校验值；程序会保留你的倾向，并在预算不足或超额时自动缩放、补齐。不要填写基础值或 total。
6. 职业点只能分配给本职技能；兴趣点可以分配给任何合理技能。尽量列出 8–14 个与人设相关的技能，不要只列一两个。
7. 技能总计不得超过 99。信用评级也要作为一项技能输出，程序会预留信用评级点数。
8. 只输出 JSON，不要 Markdown 代码围栏，不要解释文本。JSON 结构：
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
 * 按总预算分配技能点：AI 输出的 occupation / interest 只作为相对权重，
 * 程序从 EDU×2 / INT×2 的总额出发，精确分配，不再“先分再检测”。
 */
function allocateWeightedPoints(budget, entries) {
  const total = Math.max(0, Math.floor(Number(budget) || 0));
  const pool = (entries || []).filter((entry) => entry.capacity > 0);
  if (!pool.length) return total;
  const totalWeight = pool.reduce((sum, entry) => sum + Math.max(0, entry.weight || 0), 0);
  const weights = pool.map((entry) =>
    totalWeight > 0 ? Math.max(0, entry.weight || 0) : 1
  );
  const sumWeight = weights.reduce((sum, weight) => sum + weight, 0) || pool.length;
  let remaining = total;

  // 优先保留 AI 的“目标点数”；不足总预算的部分再均匀补足，
  // 避免因为 AI 只写了一个高兴趣技能，就把全部兴趣点灌到同一个技能上。
  const baselineSum = pool.reduce(
    (sum, entry) => sum + Math.min(entry.capacity, Math.max(0, entry.baseline || 0)),
    0
  );
  if (baselineSum > 0) {
    const scale = total < baselineSum ? total / baselineSum : 1;
    for (const entry of pool) {
      const points = Math.min(
        entry.capacity,
        Math.floor(Math.max(0, entry.baseline || 0) * scale)
      );
      entry.allocated = points;
      remaining -= points;
    }
  } else {
    const exact = pool.map((entry, index) => {
      const value = (total * weights[index]) / sumWeight;
      return { entry, value, fraction: value - Math.floor(value) };
    });
    for (const item of exact) {
      const points = Math.min(item.entry.capacity, Math.floor(item.value));
      item.entry.allocated = points;
      remaining -= points;
    }
    exact.sort((a, b) => b.fraction - a.fraction || (b.entry.weight || 0) - (a.entry.weight || 0));
    for (const item of exact) {
      if (remaining <= 0) break;
      if (item.entry.allocated < item.entry.capacity) {
        item.entry.allocated += 1;
        remaining -= 1;
      }
    }
  }

  // 仍有剩余时按权重循环补齐；每轮每个技能最多 +1，避免单点堆积。
  const order = [...pool].sort(
    (a, b) => Math.max(0, b.weight || 0) - Math.max(0, a.weight || 0)
  );
  let guard = 0;
  while (remaining > 0 && guard < 10000) {
    let progressed = false;
    for (const entry of order) {
      if (remaining <= 0) break;
      if (entry.allocated < entry.capacity) {
        entry.allocated += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
    guard += 1;
  }
  return remaining;
}

export function validateAIBuild(payload, { occupationId, age }) {
  const errors = [];
  const warnings = [];
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
  const pool = new Map();
  for (const skill of createSkillList(occupation.id, adjusted.attributes)) {
    pool.set(skill.name, { ...skill });
  }
  const aiWeights = new Map();
  for (const rawSkill of Array.isArray(payload?.skills) ? payload.skills : []) {
    const name = String(rawSkill?.name || '').trim();
    if (!name) continue;
    const occupationWeight = Math.max(0, Number(rawSkill.occupation) || 0);
    const interestWeight = Math.max(0, Number(rawSkill.interest) || 0);
    if (aiWeights.has(name)) {
      const previous = aiWeights.get(name);
      previous.occupation = Math.max(previous.occupation, occupationWeight);
      previous.interest = Math.max(previous.interest, interestWeight);
      continue;
    }
    aiWeights.set(name, { occupation: occupationWeight, interest: interestWeight });
    if (!pool.has(name)) {
      pool.set(name, {
        name,
        base: baseSkillValue(name, adjusted.attributes),
        occupation: 0,
        interest: 0,
        checked: false,
      });
    }
  }

  // 信用评级是强制项：预留职业点，缺失时从范围中位数补足。
  const creditMin = Number(occupation.creditRange?.[0] ?? 0);
  const creditMax = Number(occupation.creditRange?.[1] ?? 99);
  const creditFromSkill = aiWeights.get('信用评级')?.occupation;
  let rawCredit = Number(payload?.creditRating);
  if (!Number.isFinite(rawCredit) && Number.isFinite(creditFromSkill)) rawCredit = creditFromSkill;
  if (!Number.isFinite(rawCredit)) {
    rawCredit = Math.round((creditMin + creditMax) / 2);
    warnings.push('AI 没有给出信用评级，已使用职业允许区间的中位数。');
  }
  let creditRating = Math.round(rawCredit);
  if (creditRating < creditMin || creditRating > creditMax) {
    creditRating = Math.min(creditMax, Math.max(creditMin, creditRating));
    warnings.push(`信用评级已调整到职业允许区间 ${creditMin}–${creditMax}。`);
  }
  const creditBase = pool.get('信用评级')?.base || 0;
  creditRating = Math.max(0, Math.min(99 - creditBase, creditRating, occupationBudget));
  if (!pool.has('信用评级')) {
    pool.set('信用评级', {
      name: '信用评级',
      base: creditBase,
      occupation: 0,
      interest: 0,
      checked: false,
    });
  }
  const creditEntry = pool.get('信用评级');
  creditEntry.occupationAllocated = creditRating;
  const occupationRemaining = Math.max(0, occupationBudget - creditRating);

  const occupationNames =
    occupation.id === 'custom'
      ? [...pool.keys()].filter((name) => name !== '信用评级')
      : [...occupationSkillSet(occupation)].filter(
          (name) => name !== '信用评级' && pool.has(name)
        );
  if (!occupationNames.length && occupationRemaining > 0) {
    warnings.push('没有可分配的本职技能，职业点转入兴趣预算。');
  }
  for (const name of occupationNames) {
    if (aiWeights.get(name)?.occupation > 0 || aiWeights.get(name)?.interest > 0) continue;
    // 没有 AI 权重的本职技能保持 0，不强行摊平；全部为零时由分配器均分。
  }
  const occupationEntries = occupationNames.map((name) => {
    const ai = aiWeights.get(name);
    return {
      name,
      weight: (ai?.occupation || 0) + (ai?.interest ? ai.interest * 0.5 : 0) || 1,
      baseline: ai?.occupation || 0,
      capacity: Math.max(0, 99 - (pool.get(name)?.base || 0)),
      allocated: 0,
    };
  });
  const leftoverOccupation = allocateWeightedPoints(occupationRemaining, occupationEntries);
  for (const entry of occupationEntries) {
    const skill = pool.get(entry.name);
    if (skill) skill.occupationAllocated = entry.allocated;
  }
  if (leftoverOccupation > 0) {
    warnings.push(`职业点仍有 ${leftoverOccupation} 点无法分配（技能上限 99）。`);
  }

  const interestNames = [...pool.keys()].filter((name) => name !== '信用评级');
  const interestEntries = interestNames.map((name) => {
    const skill = pool.get(name);
    const ai = aiWeights.get(name);
    return {
      name,
      weight: ai?.interest || 0,
      baseline: ai?.interest || 0,
      capacity: Math.max(
        0,
        99 - (skill?.base || 0) - Math.max(0, skill?.occupationAllocated || 0)
      ),
      allocated: 0,
    };
  });
  const leftoverInterest = allocateWeightedPoints(interestBudget, interestEntries);
  for (const entry of interestEntries) {
    const skill = pool.get(entry.name);
    if (skill) skill.interestAllocated = entry.allocated;
  }
  if (leftoverInterest > 0) {
    warnings.push(`兴趣点仍有 ${leftoverInterest} 点无法分配（技能上限 99）。`);
  }

  const finalSkills = [...pool.values()].map((skill) =>
    recalculateSkill({
      name: skill.name,
      base: skill.base,
      occupation: Math.max(0, Math.floor(skill.occupationAllocated || 0)),
      interest: Math.max(0, Math.floor(skill.interestAllocated || 0)),
      checked: false,
    })
  );
  const occupationSpent = finalSkills.reduce((sum, skill) => sum + skill.occupation, 0);
  const interestSpent = finalSkills.reduce((sum, skill) => sum + skill.interest, 0);
  if (occupationSpent !== occupationBudget) {
    warnings.push(`职业点 ${occupationSpent} / ${occupationBudget}，请检查技能上限。`);
  }
  if (interestSpent !== interestBudget) {
    warnings.push(`兴趣点 ${interestSpent} / ${interestBudget}，请检查技能上限。`);
  }

  const build = {
    occupationId: occupation.id,
    age,
    attributes: adjusted.attributes,
    rawAttributes: { ...rawAttributes },
    luck,
    creditRating,
    skills: finalSkills,
  };
  const ruleCheck = validateBuild(build);
  const allErrors = [...new Set([...errors, ...ruleCheck.errors])];
  const allWarnings = [...new Set([...warnings, ...ruleCheck.warnings])];
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
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
      occupationRemaining: Math.max(0, occupationBudget - occupationSpent),
      interestRemaining: Math.max(0, interestBudget - interestSpent),
    },
    occupation,
    allocation: {
      creditRating,
      occupationWeights: occupationEntries,
      interestWeights: interestEntries,
    },
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
        )}\n注意：属性必须是年龄修正前的原始骰点；技能 occupation/interest 只作为目标点数/权重，程序会按总预算精确分配；请列出 8–14 个与人设相关的技能，并包含信用评级。`,
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
