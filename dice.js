/**
 * dice.js — Cthulhu Table 骰子引擎
 *
 * 纯前端、零依赖，包含：
 * 1. 骰子表达式解析：1d100、3d6、2d6+6、1d8+1d4+2、4d6k3、4d6kh3、4d6kl1
 * 2. CoC 7e 百分骰与奖励/惩罚骰（1~2 个）
 * 3. 六档成功等级：大成功 / 极难成功 / 困难成功 / 常规成功 / 失败 / 大失败
 * 4. 对抗检定、SAN 检定、伤害与重伤、幸运消耗
 *
 * 规则出处：
 * -《克苏鲁的呼唤》第七版核心规则书 · 第四章「技能检定」
 * - 大成功：掷出 01；大失败：96–100，若技能值 ≥50 则只有 100 为大失败。
 * - 极难成功：≤ 技能值/5；困难成功：≤ 技能值/2；常规成功：≤ 技能值。
 * - 奖励/惩罚骰：额外十位骰，奖励取最低、惩罚取最高；多个奖励与惩罚先抵消。
 *
 * 随机源可注入（rng 返回 [0, 1)），便于单元测试复现。
 */

export const DICE_ERROR = 'DICE_ERROR';

export class DiceError extends Error {
  constructor(message, code = DICE_ERROR) {
    super(message);
    this.name = 'DiceError';
    this.code = code;
  }
}

export const SUCCESS_LEVEL = Object.freeze({
  CRITICAL: 'critical',
  EXTREME: 'extreme',
  HARD: 'hard',
  REGULAR: 'regular',
  FAILURE: 'failure',
  FUMBLE: 'fumble',
});

export const SUCCESS_LABEL = Object.freeze({
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '常规成功',
  failure: '失败',
  fumble: '大失败',
});

export const SUCCESS_RANK = Object.freeze({
  fumble: 0,
  failure: 0,
  regular: 1,
  hard: 2,
  extreme: 3,
  critical: 4,
});

export const DIFFICULTY = Object.freeze({
  regular: 1,
  hard: 2,
  extreme: 3,
});

export const DIFFICULTY_LABEL = Object.freeze({
  regular: '常规',
  hard: '困难',
  extreme: '极难',
});

const MAX_DICE = 1000;
const MAX_SIDES = 1000;

/* =========================================================
 * 随机源
 * ========================================================= */

/**
 * 默认使用 crypto.getRandomValues；没有时退回 Math.random。
 * 注意：这里返回的是 [0, 1)，正好适配注入式 rng。
 */
export function systemRng() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] / 4294967296;
  }
  return Math.random();
}

export function rollDie(sides, rng = systemRng) {
  const safeSides = Math.floor(Number(sides));
  if (!Number.isInteger(safeSides) || safeSides < 1 || safeSides > MAX_SIDES) {
    throw new DiceError(`骰子面数必须在 1–${MAX_SIDES} 之间，收到：${sides}`);
  }
  const value = Number(rng());
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new DiceError('随机源必须返回 [0, 1) 之间的数。');
  }
  return Math.floor(value * safeSides) + 1;
}

/* =========================================================
 * 表达式词法/语法解析
 * ========================================================= */

function isDigit(character) {
  return character >= '0' && character <= '9';
}

function readInteger(source, cursor) {
  let index = cursor;
  while (index < source.length && isDigit(source[index])) index += 1;
  if (index === cursor) return { value: null, next: cursor };
  return { value: Number(source.slice(cursor, index)), next: index };
}

/**
 * 词法分析：把 "4d6k3+2" 切成 number / dice / operator 记号。
 * 直接把骰子识别成一个 token，避免 "d" 与普通标识符混淆。
 */
export function tokenize(expression) {
  const source = String(expression ?? '').trim();
  if (!source) throw new DiceError('骰子表达式不能为空。');
  if (source.length > 200) throw new DiceError('骰子表达式过长（最多 200 字符）。');

  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (isDigit(character) || character === 'd' || character === 'D') {
      let count = 1;
      if (isDigit(character)) {
        const number = readInteger(source, index);
        count = number.value;
        index = number.next;
        if (source[index] !== 'd' && source[index] !== 'D') {
          tokens.push({ type: 'number', value: count });
          continue;
        }
      }

      // 此时 index 指向 d。
      index += 1;
      const sides = readInteger(source, index);
      if (sides.value === null) throw new DiceError('骰子表达式缺少面数，例如 1d100。');
      index = sides.next;
      if (count < 1 || count > MAX_DICE) {
        throw new DiceError(`骰子数量必须在 1–${MAX_DICE} 之间。`);
      }
      if (sides.value < 1 || sides.value > MAX_SIDES) {
        throw new DiceError(`骰子面数必须在 1–${MAX_SIDES} 之间。`);
      }

      let keepMode = null;
      let keepCount = null;
      if (source[index] === 'k' || source[index] === 'K') {
        index += 1;
        if (source[index] === 'h' || source[index] === 'H') {
          keepMode = 'kh';
          index += 1;
        } else if (source[index] === 'l' || source[index] === 'L') {
          keepMode = 'kl';
          index += 1;
        } else {
          keepMode = 'kh';
        }
        const keep = readInteger(source, index);
        keepCount = keep.value === null ? 1 : keep.value;
        if (keep.value !== null) index = keep.next;
        if (keepCount < 1 || keepCount > count) {
          throw new DiceError(`保留骰数必须在 1–${count} 之间。`);
        }
      }

      tokens.push({
        type: 'dice',
        count,
        sides: sides.value,
        keepMode,
        keepCount,
      });
      continue;
    }

    if ('+-*/()'.includes(character)) {
      tokens.push({ type: character });
      index += 1;
      continue;
    }

    throw new DiceError(`无法识别的字符「${character}」，位置 ${index + 1}。`);
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  consume(type) {
    const token = this.peek();
    if (token.type !== type) throw new DiceError(`语法错误：期望 ${type}。`);
    this.index += 1;
    return token;
  }

  parse() {
    const node = this.parseAdditive();
    if (this.peek().type !== 'eof') {
      throw new DiceError('语法错误：表达式末尾有多余内容。');
    }
    return node;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek().type === '+' || this.peek().type === '-') {
      const operator = this.peek().type;
      this.index += 1;
      const right = this.parseMultiplicative();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.peek().type === '*' || this.peek().type === '/') {
      const operator = this.peek().type;
      this.index += 1;
      const right = this.parseUnary();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.peek().type === '+' || this.peek().type === '-') {
      const operator = this.peek().type;
      this.index += 1;
      return { type: 'unary', operator, argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'number') {
      this.index += 1;
      return { type: 'number', value: token.value };
    }
    if (token.type === 'dice') {
      this.index += 1;
      return { type: 'dice', ...token };
    }
    if (token.type === '(') {
      this.index += 1;
      const node = this.parseAdditive();
      this.consume(')');
      return node;
    }
    throw new DiceError('语法错误：这里需要一个数字、骰子或左括号。');
  }
}

export function parseExpression(expression) {
  return new Parser(tokenize(expression)).parse();
}

/* =========================================================
 * 表达式求值
 * ========================================================= */

function notationOf(node) {
  if (!node.keepMode) return `${node.count}d${node.sides}`;
  return `${node.count}d${node.sides}${node.keepMode === 'kh' ? 'k' : 'kl'}${node.keepCount}`;
}

function evaluateNode(node, rng, terms) {
  if (node.type === 'number') return node.value;

  if (node.type === 'unary') {
    const value = evaluateNode(node.argument, rng, terms);
    return node.operator === '-' ? -value : value;
  }

  if (node.type === 'dice') {
    const rolls = [];
    for (let index = 0; index < node.count; index += 1) {
      rolls.push(rollDie(node.sides, rng));
    }

    let kept = rolls;
    if (node.keepMode === 'kh') {
      kept = [...rolls].sort((a, b) => b - a).slice(0, node.keepCount);
    } else if (node.keepMode === 'kl') {
      kept = [...rolls].sort((a, b) => a - b).slice(0, node.keepCount);
    }

    const total = kept.reduce((sum, value) => sum + value, 0);
    terms.push({
      kind: 'dice',
      notation: notationOf(node),
      rolls,
      kept,
      total,
      keepMode: node.keepMode,
      keepCount: node.keepCount,
    });
    return total;
  }

  if (node.type === 'binary') {
    const left = evaluateNode(node.left, rng, terms);
    const right = evaluateNode(node.right, rng, terms);
    switch (node.operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) throw new DiceError('表达式不能除以 0。');
        return left / right;
      default:
        throw new DiceError(`未知运算符：${node.operator}`);
    }
  }

  throw new DiceError('未知表达式节点。');
}

function roundNumber(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 掷一个骰子表达式。
 * @param {string} expression 例如 "4d6k3"、"2d6+6"
 * @param {{rng?: Function}} options
 * @returns {{expression:string,total:number,terms:Array,text:string}}
 */
export function rollExpression(expression, { rng = systemRng } = {}) {
  const ast = parseExpression(expression);
  const terms = [];
  const total = roundNumber(evaluateNode(ast, rng, terms), 4);
  const pieces = terms.map((term) => {
    if (term.keepMode) {
      return `${term.notation} [${term.rolls.join(', ')}] 取${term.kept.join('+')}`;
    }
    return `${term.notation} [${term.rolls.join(', ')}]`;
  });
  return {
    expression: String(expression).trim(),
    total,
    terms,
    text: `${String(expression).trim()} = ${total}${pieces.length ? `（${pieces.join('；')}）` : ''}`,
  };
}

/* =========================================================
 * CoC 百分骰与奖励/惩罚骰
 * ========================================================= */

function normalizeDiceCount(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(2, number));
}

/**
 * 掷 1D100，支持最多 2 个奖励/惩罚骰。
 * 十位骰为 0–9（0 代表 00），个位骰为 0–9；
 * 十位与个位同时为 0 时结果为 100。
 */
export function rollD100({ bonus = 0, penalty = 0, rng = systemRng } = {}) {
  const safeBonus = normalizeDiceCount(bonus);
  const safePenalty = normalizeDiceCount(penalty);
  const net = safeBonus - safePenalty;
  const extra = Math.abs(net);

  const tensDice = [];
  for (let index = 0; index < 1 + extra; index += 1) {
    tensDice.push(rollDie(10, rng) - 1);
  }
  const units = rollDie(10, rng) - 1;

  const candidates = tensDice.map((tens, index) => {
    const raw = tens * 10 + units;
    return {
      index,
      tens,
      units,
      raw,
      value: raw === 0 ? 100 : raw,
    };
  });

  let keptIndex = 0;
  if (net > 0) {
    // 奖励骰：取最低的十位结果。
    keptIndex = candidates.reduce(
      (best, current) => (current.value < candidates[best].value ? current.index : best),
      0
    );
  } else if (net < 0) {
    // 惩罚骰：取最高的十位结果。
    keptIndex = candidates.reduce(
      (best, current) => (current.value > candidates[best].value ? current.index : best),
      0
    );
  }

  const kept = candidates[keptIndex];
  return {
    roll: kept.value,
    tens: kept.tens * 10,
    units: kept.units,
    candidates,
    keptIndex,
    bonus: safeBonus,
    penalty: safePenalty,
    net,
    text:
      `${kept.value}` +
      (candidates.length > 1
        ? `（十位候选：${candidates.map((candidate) => `${candidate.tens}0+${candidate.units}`).join(' / ')}）`
        : ''),
  };
}

/**
 * 判定单次 D100 的自然成功等级。
 * 技能 ≥50 时，只有 100 是大失败；否则 96–100 都是大失败。
 */
export function determineSuccessLevel(roll, skill) {
  const target = Math.max(0, Number(skill) || 0);
  const value = Math.max(1, Math.min(100, Math.floor(Number(roll) || 0)));

  if (value === 1) return SUCCESS_LEVEL.CRITICAL;
  const fumbleThreshold = target >= 50 ? 100 : 96;
  if (value >= fumbleThreshold) return SUCCESS_LEVEL.FUMBLE;
  if (value <= Math.floor(target / 5)) return SUCCESS_LEVEL.EXTREME;
  if (value <= Math.floor(target / 2)) return SUCCESS_LEVEL.HARD;
  if (value <= target) return SUCCESS_LEVEL.REGULAR;
  return SUCCESS_LEVEL.FAILURE;
}

/**
 * 进行一次 CoC 检定。
 * @param {number} skill 技能值
 * @param {{bonus?:number,penalty?:number,difficulty?:'regular'|'hard'|'extreme',rng?:Function}} options
 */
export function cocCheck(skill, { bonus = 0, penalty = 0, difficulty = 'regular', rng = systemRng } = {}) {
  const target = Math.max(0, Number(skill) || 0);
  const check = rollD100({ bonus, penalty, rng });
  const level = determineSuccessLevel(check.roll, target);
  const requiredRank = DIFFICULTY[difficulty] || DIFFICULTY.regular;
  const naturalRank = SUCCESS_RANK[level] || 0;
  const passed = naturalRank >= requiredRank && level !== SUCCESS_LEVEL.FUMBLE;

  return {
    skill: target,
    difficulty,
    difficultyLabel: DIFFICULTY_LABEL[difficulty] || DIFFICULTY_LABEL.regular,
    roll: check.roll,
    rollDetail: check,
    level,
    levelLabel: SUCCESS_LABEL[level],
    passed,
    targetValue:
      difficulty === 'extreme'
        ? Math.floor(target / 5)
        : difficulty === 'hard'
          ? Math.floor(target / 2)
          : target,
    thresholds: {
      extreme: Math.floor(target / 5),
      hard: Math.floor(target / 2),
      regular: target,
    },
    text: `${check.roll} / ${target}（${DIFFICULTY_LABEL[difficulty] || '常规'}）→ ${
      SUCCESS_LABEL[level]
    }`,
  };
}

/**
 * 对抗检定：双方各掷一次常规检定。
 * 同一成功等级时比较技能值；技能相同则返回平局，由 KP 决定重掷或剧情处理。
 */
export function opposedCheck(
  activeSkill,
  passiveSkill,
  { activeBonus = 0, passiveBonus = 0, activePenalty = 0, passivePenalty = 0, rng = systemRng } = {}
) {
  const active = cocCheck(activeSkill, {
    bonus: activeBonus,
    penalty: activePenalty,
    difficulty: 'regular',
    rng,
  });
  const passive = cocCheck(passiveSkill, {
    bonus: passiveBonus,
    penalty: passivePenalty,
    difficulty: 'regular',
    rng,
  });

  let winner = null;
  let reason = '';
  const activeRank = SUCCESS_RANK[active.level] || 0;
  const passiveRank = SUCCESS_RANK[passive.level] || 0;

  if (activeRank !== passiveRank) {
    winner = activeRank > passiveRank ? 'active' : 'passive';
    reason = '成功等级更高的一方获胜。';
  } else if (active.skill !== passive.skill) {
    winner = active.skill > passive.skill ? 'active' : 'passive';
    reason = '成功等级相同，技能值更高的一方获胜。';
  } else {
    reason = '成功等级与技能值均相同，判定为平局。';
  }

  return {
    active,
    passive,
    winner,
    tie: winner === null,
    reason,
    text:
      `主动方 ${active.roll}（${active.levelLabel}） vs ` +
      `被动方 ${passive.roll}（${passive.levelLabel}）→ ` +
      (winner === 'active' ? '主动方获胜' : winner === 'passive' ? '被动方获胜' : '平局') +
      `。${reason}`,
  };
}

/* =========================================================
 * SAN 检定
 * ========================================================= */

export function parseSanLoss(expression) {
  const source = String(expression ?? '').trim();
  const parts = source.split('/');
  if (parts.length !== 2) {
    throw new DiceError('SAN 损失表达式必须形如 1/1d6。');
  }
  const success = parts[0].trim() || '0';
  const failure = parts[1].trim() || '0';
  parseExpression(success);
  parseExpression(failure);
  return { success, failure, text: `${success}/${failure}` };
}

/**
 * SAN 检定：成功损失较小值，失败损失较大值。
 * 返回临时/不定期疯狂的初步判断，最终由 KP 叙述。
 */
export function sanityCheck(
  san,
  { loss = '1/1d6', bonus = 0, penalty = 0, int = null, rng = systemRng } = {}
) {
  const currentSan = Math.max(0, Number(san) || 0);
  const lossExpression = parseSanLoss(loss);
  const check = cocCheck(currentSan, {
    bonus,
    penalty,
    difficulty: 'regular',
    rng,
  });
  const chosenExpression = check.passed ? lossExpression.success : lossExpression.failure;
  const lossRoll = rollExpression(chosenExpression, { rng });
  const lossValue = Math.max(0, Math.floor(lossRoll.total));

  const temporaryInsanity = lossValue >= 5;
  const twentyPercent = Math.ceil(currentSan * 0.2);
  const indefiniteInsanity = currentSan > 0 && lossValue >= twentyPercent;
  const intCheck =
    temporaryInsanity && Number.isFinite(Number(int))
      ? cocCheck(Number(int), { difficulty: 'regular', rng })
      : null;

  return {
    san: currentSan,
    check,
    passed: check.passed,
    lossExpression: chosenExpression,
    lossRoll,
    loss: lossValue,
    temporaryInsanity,
    indefiniteInsanity,
    intCheck,
    text:
      `SAN ${check.roll} / ${currentSan} → ${check.levelLabel}，` +
      `损失 ${lossValue} 点（${chosenExpression}）` +
      (temporaryInsanity ? '；单次损失 ≥5，触发临时性疯狂判定' : '') +
      (indefiniteInsanity ? '；损失达到当前 SAN 的 20%，可能进入不定期疯狂' : ''),
  };
}

/* =========================================================
 * 伤害 / 重伤 / 濒死 / 幸运
 * ========================================================= */

/**
 * 掷伤害，可附加伤害加值表达式（例如 "1d4" / "-1" / "0"）。
 */
export function rollDamage(expression, { db = '0', rng = systemRng } = {}) {
  const base = rollExpression(expression, { rng });
  const dbExpression = String(db).trim() || '0';
  const dbRoll = rollExpression(dbExpression, { rng });
  const total = Math.max(0, Math.floor(base.total + dbRoll.total));
  return {
    base,
    db: dbRoll,
    total,
    text: `${base.text}${dbRoll.total !== 0 ? ` + DB ${dbRoll.text}` : ''} = ${total} 点伤害`,
  };
}

/**
 * 应用伤害。重伤：单次伤害 ≥ 最大 HP 的一半（向上取整）。
 * HP ≤0：昏迷；重伤且 HP≤0：濒死。HP ≤ -最大 HP：死亡（本项目采用常见判定）。
 */
export function applyDamage(currentHp, damage, maxHp) {
  const max = Math.max(1, Math.floor(Number(maxHp) || 1));
  const before = Math.floor(Number(currentHp) || 0);
  const amount = Math.max(0, Math.floor(Number(damage) || 0));
  const after = before - amount;
  const majorWound = amount >= Math.ceil(max / 2);
  const unconscious = after <= 0;
  const dying = unconscious && majorWound;
  const dead = after <= -max;
  let status = '正常';
  if (dead) status = '死亡';
  else if (dying) status = '濒死';
  else if (unconscious) status = '昏迷';
  else if (majorWound) status = '重伤';

  return {
    before,
    amount,
    after,
    max,
    majorWound,
    unconscious,
    dying,
    dead,
    status,
    text: `HP ${before} → ${after} / ${max}，${amount} 点伤害；${status}。`,
  };
}

export function spendLuck(currentLuck, amount) {
  const luck = Math.max(0, Math.floor(Number(currentLuck) || 0));
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  const remaining = Math.max(0, luck - cost);
  return {
    before: luck,
    cost,
    remaining,
    text: `幸运 ${luck} → ${remaining}（消耗 ${cost}）`,
  };
}

/* =========================================================
 * 展示辅助
 * ========================================================= */

export function formatCheckResult(result) {
  if (!result) return '';
  return `${result.roll} / ${result.skill} · ${result.levelLabel}${result.passed ? '（通过）' : '（未通过）'}`;
}

export const dice = Object.freeze({
  rollExpression,
  parseExpression,
  rollD100,
  cocCheck,
  opposedCheck,
  determineSuccessLevel,
  sanityCheck,
  parseSanLoss,
  rollDamage,
  applyDamage,
  spendLuck,
  formatCheckResult,
  SUCCESS_LEVEL,
  SUCCESS_LABEL,
  DIFFICULTY,
  DIFFICULTY_LABEL,
});

export default dice;
