/**
 * dice.test.js — 骰子引擎 console 断言测试
 *
 * 运行方式（浏览器开发者工具控制台）：
 *   const { runDiceTests } = await import('./js/dice.test.js');
 *   runDiceTests();
 *
 * 也可以在设置页点击「运行骰子自检」。
 * 所有随机源都通过注入的 rng 固定，测试可复现。
 */

import {
  rollExpression,
  rollD100,
  determineSuccessLevel,
  cocCheck,
  opposedCheck,
  sanityCheck,
  applyDamage,
  spendLuck,
  DiceError,
  SUCCESS_LEVEL,
} from './dice.js';

function sequence(values) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

export function runDiceTests({ log = true } = {}) {
  let passed = 0;
  let failed = 0;
  const failures = [];

  const check = (condition, message, actual = undefined) => {
    if (condition) {
      passed += 1;
      console.assert(true, `✓ ${message}`);
      return;
    }
    failed += 1;
    failures.push(message);
    console.assert(false, `✗ ${message}`, actual);
  };

  if (log) console.groupCollapsed('%cCthulhu Table · 骰子引擎自检', 'color:#b99a5b');

  // 1. 表达式与保留最高
  const keepHigh = rollExpression('4d6k3', { rng: sequence([0, 0.5, 0.99, 0.2]) });
  check(keepHigh.total === 12, '4d6k3 保留最高三颗，结果为 12', keepHigh.total);
  check(keepHigh.terms[0].rolls.join(',') === '1,4,6,2', '4d6k3 记录全部原始骰', keepHigh.terms);

  const keepLow = rollExpression('4d6kl1', { rng: sequence([0, 0.5, 0.99, 0.2]) });
  check(keepLow.total === 1, '4d6kl1 保留最低一颗，结果为 1', keepLow.total);

  // 2. 算术与优先级
  const arithmetic = rollExpression('1d6+2*3', { rng: sequence([0.5]) });
  check(arithmetic.total === 10, '1d6+2*3 遵循乘法优先级，结果为 10', arithmetic.total);
  const parentheses = rollExpression('(1d6+2)*3', { rng: sequence([0.5]) });
  check(parentheses.total === 18, '(1d6+2)*3 尊重括号，结果为 18', parentheses.total);

  // 3. 百分骰：正常、奖励、惩罚
  const normal = rollD100({ rng: sequence([0.7, 0.2]) });
  check(normal.roll === 72, '普通 D100：70 + 2 = 72', normal);
  // 十位 7、奖励十位 2、个位 5 => 候选 75 / 25，奖励取 25
  const bonus = rollD100({ bonus: 1, rng: sequence([0.7, 0.2, 0.5]) });
  check(bonus.roll === 25, '1 个奖励骰取较低十位，结果为 25', bonus);
  // 同样候选，惩罚取 75
  const penalty = rollD100({ penalty: 1, rng: sequence([0.7, 0.2, 0.5]) });
  check(penalty.roll === 75, '1 个惩罚骰取较高十位，结果为 75', penalty);
  check(bonus.candidates.length === 2, '奖励骰记录全部十位候选', bonus.candidates);

  // 4. 00 + 0 = 100
  const hundred = rollD100({ rng: sequence([0, 0]) });
  check(hundred.roll === 100, '00 与 0 的组合是 100，而不是 0', hundred);
  // 0 + 1 = 1
  const one = rollD100({ rng: sequence([0, 0.1]) });
  check(one.roll === 1, '十位 0、个位 1 的组合是 1', one);

  // 5. 六档成功等级
  check(determineSuccessLevel(1, 30) === SUCCESS_LEVEL.CRITICAL, '掷出 1 为大成功');
  check(determineSuccessLevel(6, 30) === SUCCESS_LEVEL.EXTREME, '6 / 30 为极难成功');
  check(determineSuccessLevel(14, 30) === SUCCESS_LEVEL.HARD, '14 / 30 为困难成功');
  check(determineSuccessLevel(29, 30) === SUCCESS_LEVEL.REGULAR, '29 / 30 为常规成功');
  check(determineSuccessLevel(31, 30) === SUCCESS_LEVEL.FAILURE, '31 / 30 为失败');
  check(determineSuccessLevel(96, 49) === SUCCESS_LEVEL.FUMBLE, '技能 <50 时 96 为大失败');
  check(determineSuccessLevel(96, 98) === SUCCESS_LEVEL.REGULAR, '技能 ≥50 时 96 不是大失败');
  check(determineSuccessLevel(100, 60) === SUCCESS_LEVEL.FUMBLE, '技能 ≥50 时 100 仍为大失败');

  // 6. 难度门槛
  const hardCheck = cocCheck(60, {
    difficulty: 'hard',
    rng: sequence([0.2, 0.9]), // 29 <= 30
  });
  check(hardCheck.roll === 29 && hardCheck.passed, '29 / 60 通过困难检定', hardCheck);
  const extremeFail = cocCheck(60, {
    difficulty: 'extreme',
    rng: sequence([0.2, 0.9]), // 29 > 12
  });
  check(!extremeFail.passed, '29 / 60 不通过极难检定', extremeFail);

  // 7. 对抗检定
  const opposed = opposedCheck(60, 40, {
    // 主动 20、被动 70
    rng: sequence([0.2, 0, 0.7, 0]),
  });
  check(opposed.winner === 'active', '主动方常规成功、被动方失败时主动方获胜', opposed);
  const opposedTie = opposedCheck(50, 50, {
    rng: sequence([0.2, 0, 0.2, 0]),
  });
  check(opposedTie.tie, '成功等级与技能值相同判为平局', opposedTie);

  // 8. SAN 检定
  const sanSuccess = sanityCheck(50, {
    loss: '1/1d6',
    rng: sequence([0.2, 0.9]), // 29，成功
  });
  check(sanSuccess.passed && sanSuccess.loss === 1, 'SAN 检定成功损失 1 点', sanSuccess);
  const sanFail = sanityCheck(50, {
    loss: '1/1d6',
    rng: sequence([0.8, 0, 0.5]), // 80 失败；1d6=4
  });
  check(!sanFail.passed && sanFail.loss === 4, 'SAN 检定失败损失 1d6=4 点', sanFail);
  check(!sanFail.temporaryInsanity, '单次 SAN 损失 4 点不触发临时疯狂', sanFail);
  const sanTemporary = sanityCheck(50, {
    loss: '5/1d6',
    rng: sequence([0.2, 0.9]), // 29，成功，损失 5
  });
  check(sanTemporary.temporaryInsanity, '单次 SAN 损失 ≥5 触发临时疯狂判定', sanTemporary);

  // 9. 伤害与濒死
  const major = applyDamage(10, 6, 12);
  check(major.majorWound && major.status === '重伤', '单次伤害 ≥ 最大 HP 一半为重伤', major);
  const dying = applyDamage(5, 8, 12);
  check(dying.dying && dying.status === '濒死', '重伤且 HP≤0 为濒死', dying);

  // 10. 幸运
  const luck = spendLuck(45, 10);
  check(luck.remaining === 35, '幸运 45 消耗 10 后剩余 35', luck);

  // 11. 错误处理
  let invalidThrown = false;
  try {
    rollExpression('1d');
  } catch (error) {
    invalidThrown = error instanceof DiceError;
  }
  check(invalidThrown, '非法表达式抛出 DiceError');

  if (log) {
    console.log(
      `%c骰子自检：${passed} 通过 / ${failed} 失败`,
      failed ? 'color:#bd5356;font-weight:bold' : 'color:#7fa48d;font-weight:bold'
    );
    console.groupEnd();
  }

  return { passed, failed, total: passed + failed, failures };
}

// 直接打开本文件时也可以在控制台手动调用。
if (typeof window !== 'undefined') {
  window.runDiceTests = runDiceTests;
}
