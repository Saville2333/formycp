/**
 * character-view.js — 调查员名册与车卡工作台
 */

import { storage } from '../storage.js';
import { api } from '../api.js';
import {
  ATTRIBUTE_META,
  ATTRIBUTE_KEYS,
  OCCUPATIONS,
  SKILL_CATALOG,
  SKILL_CATEGORIES,
  ageBracket,
  applyBuildToCharacter,
  baseSkillValue,
  calculateDerived,
  characterToMarkdown,
  createDraft,
  createSkillList,
  generateCharacterWithAI,
  getOccupation,
  randomizeDraft,
  recalculateSkill,
  validateBuild,
} from '../character.js';
import {
  escapeHTML,
  safeText,
  icon,
  getInitials,
  formatDate,
  formatDateTime,
  formatRelative,
  downloadFile,
  sanitizeFilename,
  toast,
  openModal,
  confirmDialog,
  closeModal,
} from '../ui.js';

let draft = null;
let editingId = '';
let aiBusy = false;
let aiStatus = '';

function cloneDraft(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBuild(d) {
  return {
    occupationId: d.occupationId || 'detective',
    age: Number(d.age) || 30,
    attributes: { ...d.attributes },
    luck: Number(d.luck) || 0,
    creditRating: Number(d.creditRating) || 0,
    skills: Array.isArray(d.skills) ? d.skills.map((skill) => ({ ...skill })) : [],
  };
}

function characterToDraft(character) {
  const occupation =
    (character.occupationId && OCCUPATIONS.find((item) => item.id === character.occupationId)) ||
    OCCUPATIONS.find((item) => item.name === character.occupation) ||
    OCCUPATIONS.find(
      (item) =>
        item.id !== 'custom' &&
        character.occupation &&
        String(character.occupation).includes(item.name.replace(/^私家/, '').replace(/成员$/, ''))
    ) ||
    getOccupation('custom');
  return {
    ...cloneDraft(character),
    kind: character.kind === 'npc' ? 'npc' : 'pc',
    occupationId: occupation.id,
    occupation: occupation.name,
    personality: Array.isArray(character.personality) ? character.personality : [],
    languages: Array.isArray(character.languages) ? character.languages : [],
    possessions: Array.isArray(character.possessions) ? character.possessions : [],
    skills: Array.isArray(character.skills) ? character.skills.map((skill) => ({ ...skill })) : [],
  };
}

function ensureDraft(query = null) {
  const editId = query?.get?.('edit') || '';
  if (editId && editId !== editingId) {
    const character = storage.characters.get(editId);
    if (character) {
      draft = characterToDraft(character);
      editingId = character.id;
      aiStatus = '正在编辑已有调查员。';
      return;
    }
  }
  if (!draft) {
    draft = createDraft({ occupationId: 'detective', age: 30 });
    editingId = '';
    aiStatus = '';
  }
  syncDraft(draft);
}

function syncCreditSkill(d) {
  const credit = Math.max(0, Math.floor(Number(d.creditRating) || 0));
  d.creditRating = credit;
  let skill = d.skills.find((item) => item.name === '信用评级');
  if (!skill) {
    skill = {
      name: '信用评级',
      base: 0,
      occupation: credit,
      interest: 0,
      total: credit,
      checked: false,
    };
    d.skills.unshift(skill);
  } else {
    skill.base = 0;
    skill.occupation = credit;
    skill.interest = 0;
    skill.total = credit;
  }
}

export function syncDraft(d) {
  if (!d) return;
  d.age = Math.max(15, Math.min(120, Math.floor(Number(d.age) || 30)));
  d.luck = Math.max(0, Math.min(99, Math.floor(Number(d.luck) || 0)));
  d.creditRating = Math.max(0, Math.min(99, Math.floor(Number(d.creditRating) || 0)));
  for (const key of ATTRIBUTE_KEYS) {
    d.attributes[key] = Math.max(1, Math.min(99, Math.floor(Number(d.attributes[key]) || 1)));
  }
  d.skills = Array.isArray(d.skills)
    ? d.skills.map((skill) => {
        const name = String(skill.name || '').trim();
        const base = baseSkillValue(name, d.attributes);
        const occupation = Math.max(0, Math.floor(Number(skill.occupation) || 0));
        const interest = Math.max(0, Math.floor(Number(skill.interest) || 0));
        return recalculateSkill({
          name,
          base,
          occupation,
          interest,
          checked: Boolean(skill.checked),
        });
      })
    : [];
  syncCreditSkill(d);
  d.derived = calculateDerived(d.attributes, d.age);
  d.occupationPoints = d.attributes.edu * 2;
  d.interestPoints = d.attributes.int * 2;
  d.pointsSpent = {
    occupation: d.skills.reduce((sum, skill) => sum + skill.occupation, 0),
    interest: d.skills.reduce((sum, skill) => sum + skill.interest, 0),
  };
}

function pageHead(kicker, title, lede, actions = '') {
  return `
    <header class="page-head">
      <div class="page-head__main">
        <p class="page-kicker">${escapeHTML(kicker)}</p>
        <h1 class="page-title">${escapeHTML(title)}</h1>
        ${lede ? `<p class="page-lede">${escapeHTML(lede)}</p>` : ''}
      </div>
      ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
    </header>`;
}

function renderCharacterCard(character) {
  const hp = character.derived?.hp || { current: '—', max: '—' };
  const san = character.derived?.san || { current: '—', max: '—' };
  const mov = character.derived?.mov ?? '—';
  const quote = character.catchphrase
    ? `“${character.catchphrase}”`
    : character.personality?.length
      ? character.personality.slice(0, 3).join(' · ')
      : '尚未留下口头禅。';
  return `
    <article class="character-card">
      <div class="character-card__top">
        <div class="character-card__portrait">${escapeHTML(getInitials(character.name))}</div>
        <div class="character-card__identity">
          <h2 class="character-card__name">
            <span>${escapeHTML(character.name)}</span>
            <span class="tag ${character.kind === 'npc' ? 'tag--npc' : 'tag--pc'}">${
              character.kind === 'npc' ? 'NPC' : 'PL'
            }</span>
            ${character.isSample ? '<span class="tag">示例</span>' : ''}
          </h2>
          <p class="character-card__meta">${escapeHTML(
            [character.age ? `${character.age} 岁` : '', character.gender, character.occupation]
              .filter(Boolean)
              .join(' · ') || '身份未填写'
          )}</p>
        </div>
      </div>
      <p class="character-card__quote">${escapeHTML(quote)}</p>
      <div class="character-card__vitals">
        <div class="vital"><span class="vital__label">HP</span><span class="vital__value">${escapeHTML(
          hp.current
        )}<small> / ${escapeHTML(hp.max)}</small></span></div>
        <div class="vital"><span class="vital__label">SAN</span><span class="vital__value">${escapeHTML(
          san.current
        )}<small> / ${escapeHTML(san.max)}</small></span></div>
        <div class="vital"><span class="vital__label">MOV</span><span class="vital__value">${escapeHTML(
          mov
        )}</span></div>
      </div>
      <div class="character-card__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-action="view-character" data-character-id="${escapeHTML(
          character.id
        )}">${icon('file')} 档案</button>
        <button class="btn btn--gold btn--sm" type="button" data-action="edit-character" data-character-id="${escapeHTML(
          character.id
        )}">${icon('edit')} 编辑</button>
        <span class="faint">${escapeHTML(formatRelative(character.updatedAt))}</span>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-character" data-character-id="${escapeHTML(
          character.id
        )}" aria-label="删除 ${escapeHTML(character.name)}" title="删除档案">${icon(
          'trash',
          'icon--sm'
        )}</button>
      </div>
    </article>`;
}

function renderCharacterList() {
  const characters = storage.characters.list();
  const actions = `
    <a class="btn btn--primary" href="#/builder" data-action="new-character">${icon(
      'plus'
    )} 新建调查员</a>
    <button class="btn btn--ghost" type="button" data-action="import-character">${icon(
      'upload'
    )} 导入 JSON</button>
    <button class="btn btn--ghost" type="button" data-action="load-sample">${icon(
      'spark'
    )} 示例</button>`;

  return `
    ${pageHead(
      'Investigator Archive',
      '调查员名册',
      '完整人设、CoC 7e 规则引擎与本地存档。玩家调查员与 KP 的 NPC 共用同一套角色结构。',
      actions
    )}
    <input type="file" id="character-import" accept=".json,application/json" hidden>
    ${
      characters.length
        ? `<div class="char-grid">${characters.map(renderCharacterCard).join('')}</div>`
        : `<div class="empty-state">
            <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
            <h2 class="empty-state__title">名册上还没有名字</h2>
            <p class="empty-state__text">在进入阿卡姆之前，总得先知道自己是谁。现在可以按完整规则创建调查员，或载入两位示例角色。</p>
            <div class="empty-state__actions">
              <a class="btn btn--primary" href="#/builder" data-action="new-character">${icon(
                'wand'
              )} 开始车卡</a>
              <button class="btn btn--ghost" type="button" data-action="load-sample">${icon(
                'spark'
              )} 载入示例</button>
            </div>
          </div>`
    }`;
}

function field({
  label,
  key,
  type = 'text',
  placeholder = '',
  wide = false,
  min,
  max,
  step,
  value: explicitValue = undefined,
}) {
  const value = explicitValue ?? draft[key] ?? '';
  const attrs = [
    `type="${type}"`,
    `data-field="${key}"`,
    `value="${escapeHTML(value)}"`,
    placeholder ? `placeholder="${escapeHTML(placeholder)}"` : '',
    min !== undefined ? `min="${min}"` : '',
    max !== undefined ? `max="${max}"` : '',
    step !== undefined ? `step="${step}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<label class="form-field${wide ? ' form-field--wide' : ''}">
    <span class="form-field__label">${escapeHTML(label)}</span>
    <input class="form-input" ${attrs}>
  </label>`;
}

function textArea({ label, key, placeholder = '', rows = 4, wide = false, value = null }) {
  const content = value ?? draft[key] ?? '';
  return `<label class="form-field${wide ? ' form-field--wide' : ''}">
    <span class="form-field__label">${escapeHTML(label)}</span>
    <textarea class="form-input form-textarea" rows="${rows}" data-field="${key}" placeholder="${escapeHTML(
      placeholder
    )}">${escapeHTML(content)}</textarea>
  </label>`;
}

function renderAttributeGrid() {
  return `<div class="attribute-inputs">
    ${ATTRIBUTE_META.map(
      (attribute) => `
      <label class="attribute-input">
        <span class="attribute-input__abbr">${attribute.abbr}</span>
        <span class="attribute-input__name">${attribute.label}</span>
        <input type="number" min="1" max="99" step="1" data-attr="${attribute.key}" value="${escapeHTML(
          draft.attributes[attribute.key]
        )}">
        <small>${attribute.formula}</small>
      </label>`
    ).join('')}
  </div>`;
}

function renderSkillRows() {
  const occupation = getOccupation(draft.occupationId);
  const occupationSet = new Set(['信用评级', ...occupation.skills]);
  return draft.skills
    .map((skill, index) => {
      const isOccupation = occupationSet.has(skill.name);
      return `<tr data-skill-row="${index}">
        <td>
          <span class="skill-name">${escapeHTML(skill.name)}</span>
          ${isOccupation ? '<span class="tag tag--pc">本职</span>' : ''}
          ${
            !isOccupation && !['母语', '闪避', '信用评级'].includes(skill.name)
              ? `<button class="skill-remove" type="button" data-action="remove-skill" data-skill-index="${index}" title="移除这项技能" aria-label="移除 ${escapeHTML(
                  skill.name
                )}">${icon('x', 'icon--sm')}</button>`
              : ''
          }
        </td>
        <td class="num">${skill.base}</td>
        <td class="num"><input class="table-input" type="number" min="0" max="99" step="1" value="${
          skill.occupation
        }" data-skill-index="${index}" data-skill-part="occupation" ${
          isOccupation || occupation.id === 'custom' ? '' : 'disabled title="非本职技能不能使用职业点"'
        }></td>
        <td class="num"><input class="table-input" type="number" min="0" max="99" step="1" value="${
          skill.interest
        }" data-skill-index="${index}" data-skill-part="interest"></td>
        <td class="num"><strong data-skill-total="${index}">${skill.total}</strong></td>
      </tr>`;
    })
    .join('');
}

function skillCatalogIndex() {
  const seen = new Set();
  return SKILL_CATALOG.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
}

function renderSkillPickerList(filter = '', category = 'all') {
  const query = String(filter || '').trim().toLowerCase();
  const rows = skillCatalogIndex().filter(({ entry }) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!query) return true;
    return `${entry.name} ${entry.note || ''}`.toLowerCase().includes(query);
  });
  if (!rows.length) return '<p class="empty-hint">没有匹配的技能。</p>';
  return SKILL_CATEGORIES.map((group) => {
    const groupRows = rows.filter(({ entry }) => entry.category === group.id);
    if (!groupRows.length) return '';
    return `<section class="skill-picker__group">
      <h4 class="skill-picker__heading">${escapeHTML(group.name)} <span>${groupRows.length}</span></h4>
      <div class="skill-picker__rows">
        ${groupRows
          .map(({ entry, index }) => {
            const owned = draft.skills.some((skill) => skill.name === entry.name);
            return `<div class="skill-picker__row">
              <div class="skill-picker__body">
                <strong>${escapeHTML(entry.name)}</strong>
                ${entry.note ? `<small>${escapeHTML(entry.note)}</small>` : ''}
              </div>
              <span class="skill-picker__base">${entry.base}%</span>
              <button class="btn btn--ghost btn--sm" type="button" data-add-catalog-skill="${index}" ${
                owned ? 'disabled title="已在技能表中"' : ''
              }>${owned ? '已有' : entry.detail ? '选择子类' : '添加'}</button>
            </div>`;
          })
          .join('')}
      </div>
    </section>`;
  }).join('');
}

function derivedTile(label, value, key) {
  return `<div class="derived-tile">
    <span class="derived-tile__label">${escapeHTML(label)}</span>
    <span class="derived-tile__value" data-derived="${key}">${escapeHTML(value)}</span>
  </div>`;
}

function renderBuilder() {
  const occupation = getOccupation(draft.occupationId);
  const validation = validateBuild(getBuild(draft));
  const profile = storage.settings.getActiveApiProfile();
  const aiDisabled = !profile ? 'disabled' : '';
  return `
    ${pageHead(
      editingId ? 'Edit Investigator' : 'Investigator Workshop',
      editingId ? '编辑调查员' : '车卡工坊',
      '属性、年龄修正、DB / Build、技能点与信用评级都由前端规则引擎实时校验。可手工分配，也可随机骰点或交给 AI。',
      `<a class="btn btn--ghost" href="#/characters">${icon(
        'arrow-right'
      )} 返回名册</a><span class="stage-badge"><span class="stage-badge__dot"></span>${
        editingId ? '编辑中' : '新角色'
      }</span>`
    )}

    <div class="builder-layout">
      <div class="builder-main">
        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('users')} 身份与外貌</h2>
            <span class="panel__meta">IDENTITY</span>
          </div>
          <div class="form-grid">
            ${field({ label: '姓名 *', key: 'name', placeholder: '例如：林墨秋' })}
            ${field({ label: '年龄 *', key: 'age', type: 'number', min: 15, max: 120 })}
            ${field({ label: '性别', key: 'gender', placeholder: '女 / 男 / 其他' })}
            ${field({ label: '国籍', key: 'nationality', placeholder: '中国' })}
            ${field({ label: '身高（cm）', key: 'heightCm', type: 'number', min: 0, max: 300 })}
            ${field({ label: '体重（kg）', key: 'weightKg', type: 'number', min: 0, max: 500 })}
            ${field({
              label: '性格关键词（顿号分隔）',
              key: 'personality',
              wide: true,
              placeholder: '敏锐、嘴硬心软、对真相成瘾',
              value: (draft.personality || []).join('、'),
            })}
            ${field({ label: '口头禅', key: 'catchphrase', wide: true, placeholder: '先别急着下结论。' })}
            ${textArea({ label: '外貌', key: 'appearance', rows: 3, wide: true })}
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('scroll')} 人设与动机</h2>
            <span class="panel__meta">BACKSTORY</span>
          </div>
          <div class="form-grid">
            ${textArea({ label: '背景故事', key: 'background', rows: 6, wide: true })}
            ${textArea({
              label: '详细角色设定（角色扮演用，支持一万字以上）',
              key: 'detailedSetting',
              rows: 18,
              wide: true,
              placeholder:
                '可写入完整成长经历、价值观、说话方式、人际关系、秘密、习惯、对超自然的态度、角色目标等。此字段不设前端字数上限，会用于 AI 代演与守秘人上下文。',
            })}
            ${textArea({ label: '加入调查的原因', key: 'joinReason', rows: 3, wide: true })}
            ${textArea({ label: '重要之人', key: 'importantPerson', rows: 2 })}
            ${textArea({ label: '信念 / 理念', key: 'ideology', rows: 2 })}
            ${textArea({ label: '意义非凡之地', key: 'significantPlace', rows: 2 })}
            ${textArea({ label: '宝贵之物', key: 'treasuredItem', rows: 2 })}
            ${textArea({ label: '特质 / 缺陷', key: 'traits', rows: 3, wide: true })}
            ${textArea({ label: '恐惧症 / 狂躁症', key: 'phobias', rows: 2, wide: true })}
            ${field({ label: '母语', key: 'motherTongue', placeholder: '中文' })}
            ${textArea({
              label: '其他语言（每行：语言 百分比）',
              key: 'languages',
              rows: 2,
              wide: true,
              placeholder: '英语 45',
              value: (draft.languages || [])
                .map((language) => `${language.name} ${language.level}`)
                .join('\n'),
            })}
            ${textArea({
              label: '随身物品（每行一件）',
              key: 'possessions',
              rows: 4,
              wide: true,
              value: (draft.possessions || []).join('\n'),
            })}
            ${textArea({ label: '备注', key: 'notes', rows: 3, wide: true })}
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('scroll')} 角色记忆</h2>
            <span class="panel__meta">${(draft.memories || []).length} MEMORIES</span>
          </div>
          ${
            draft.memories?.length
              ? `<div class="memory-list">${draft.memories
                  .map(
                    (memory) => `<article class="memory-item">
                      <div class="memory-item__head">
                        <strong>${escapeHTML(memory.moduleTitle || '未命名模组')}</strong>
                        <span class="panel__meta">${escapeHTML(
                          new Date(memory.createdAt).toLocaleDateString('zh-CN')
                        )}</span>
                      </div>
                      <p class="memory-item__summary">${escapeHTML(memory.summary)}</p>
                      ${
                        memory.keyEvents?.length
                          ? `<p class="memory-item__events">${memory.keyEvents
                              .map((event) => escapeHTML(event))
                              .join(' · ')}</p>`
                          : ''
                      }
                    </article>`
                  )
                  .join('')}</div>`
              : `<div class="info-strip">${icon(
                  'spark'
                )}<span>完成一个模组后，可以在跑团桌面点击「完结战役并总结记忆」；总结会写入角色卡，并自动带入下一次调查。</span></div>`
          }
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('dice')} 属性与年龄修正</h2>
            <span class="panel__meta">AGE ${ageBracket(draft.age)}</span>
          </div>
          <div class="form-grid form-grid--compact">
            <label class="form-field">
              <span class="form-field__label">职业模板</span>
              <select class="form-input" data-occupation>
                ${OCCUPATIONS.map(
                  (item) =>
                    `<option value="${item.id}" ${item.id === draft.occupationId ? 'selected' : ''}>${escapeHTML(
                      item.name
                    )}</option>`
                ).join('')}
              </select>
            </label>
            ${field({ label: '信用评级', key: 'creditRating', type: 'number', min: 0, max: 99 })}
            ${field({ label: '幸运', key: 'luck', type: 'number', min: 0, max: 99 })}
          </div>
          <div class="attribute-inputs">
            ${ATTRIBUTE_META.map(
              (attribute) => `
              <label class="attribute-input">
                <span class="attribute-input__abbr">${attribute.abbr}</span>
                <span class="attribute-input__name">${attribute.label}</span>
                <input type="number" min="1" max="99" step="1" data-attr="${attribute.key}" value="${
                  draft.attributes[attribute.key]
                }">
                <small>${attribute.formula}</small>
              </label>`
            ).join('')}
          </div>
          <div class="derived-grid">
            ${derivedTile('生命值 HP', `${draft.derived.hp.current} / ${draft.derived.hp.max}`, 'hp')}
            ${derivedTile('魔法值 MP', `${draft.derived.mp.current} / ${draft.derived.mp.max}`, 'mp')}
            ${derivedTile('理智 SAN', `${draft.derived.san.current} / ${draft.derived.san.max}`, 'san')}
            ${derivedTile('移动力 MOV', draft.derived.mov, 'mov')}
            ${derivedTile('伤害加值 DB', draft.derived.db, 'db')}
            ${derivedTile('体格 BUILD', draft.derived.build, 'build')}
          </div>
          <p class="rule-source">
            <strong>规则出处：</strong>CoC 7e 核心规则书 · 第三章「创建调查员」。
            属性为年龄修正后的最终值；使用「随机骰点」或 AI 车卡时会自动应用年龄修正。
            当前年龄档：${ageBracket(draft.age)}。
          </p>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('file')} 技能分配</h2>
            <div class="skill-budget">
              <span>职业 <strong data-budget-occupation>${draft.occupationPoints}</strong></span>
              <span>已用 <strong data-spent-occupation>${draft.pointsSpent.occupation}</strong></span>
              <span>兴趣 <strong data-budget-interest>${draft.interestPoints}</strong></span>
              <span>已用 <strong data-spent-interest>${draft.pointsSpent.interest}</strong></span>
            </div>
          </div>
          <div class="skill-table-wrap">
            <table class="skill-table">
              <thead><tr><th>技能</th><th>基础</th><th>职业点</th><th>兴趣点</th><th>总计</th></tr></thead>
              <tbody>${renderSkillRows()}</tbody>
            </table>
          </div>
          <div class="builder-inline-actions">
            <button class="btn btn--gold btn--sm" type="button" data-action="open-skill-picker">${icon(
              'search'
            )} 从技能表添加</button>
            <button class="btn btn--ghost btn--sm" type="button" data-action="add-custom-skill">${icon(
              'plus'
            )} 添加自定义技能</button>
            <button class="btn btn--ghost btn--sm" type="button" data-action="apply-occupation">${icon(
              'refresh'
            )} 重载职业模板</button>
          </div>
        </section>
      </div>

      <aside class="builder-side">
        <section class="panel builder-summary">
          <div class="panel__head">
            <h2 class="panel__title">${icon('wand')} 车卡控制台</h2>
            ${draft.occupation ? `<span class="tag">${escapeHTML(draft.occupation)}</span>` : ''}
          </div>
          <div class="builder-actions">
            <button class="btn btn--gold" type="button" data-action="randomize-character">${icon(
              'dice'
            )} 随机骰点</button>
            <button class="btn btn--primary" type="button" data-action="auto-build-character" ${
              aiDisabled || aiBusy ? 'disabled' : ''
            }>${icon('spark')} ${aiBusy ? 'AI 车卡中…' : '按人设自动车卡'}</button>
            <button class="btn btn--ghost" type="button" data-action="save-character">${icon(
              'download'
            )} 保存角色卡</button>
          </div>
          <p class="builder-ai-status" data-ai-status>${escapeHTML(
            aiStatus ||
              (profile
                ? `当前接口：${profile.name} / ${profile.model || '未填写模型'}`
                : '尚未配置 AI 接口。可以在设置页添加，或先用随机骰点与手工分配。')
          )}</p>
          <div class="budget-meter">
            <div class="budget-meter__row"><span>职业点</span><strong data-budget-label-occupation>${draft.pointsSpent.occupation} / ${draft.occupationPoints}</strong></div>
            <div class="budget-meter__bar"><span data-meter-occupation style="width:${Math.min(
              100,
              (draft.pointsSpent.occupation / Math.max(1, draft.occupationPoints)) * 100
            )}%"></span></div>
            <div class="budget-meter__row"><span>兴趣点</span><strong data-budget-label-interest>${draft.pointsSpent.interest} / ${draft.interestPoints}</strong></div>
            <div class="budget-meter__bar"><span data-meter-interest style="width:${Math.min(
              100,
              (draft.pointsSpent.interest / Math.max(1, draft.interestPoints)) * 100
            )}%"></span></div>
          </div>
          <div class="validation-box ${validation.valid ? 'is-valid' : 'is-invalid'}" data-validation-box>
            <strong>${validation.valid ? '规则校验通过' : '需要修正'}</strong>
            <p>${escapeHTML(
              validation.valid
                ? validation.warnings.slice(0, 3).join(' ') || '点数、属性与信用评级均在允许范围内。'
                : validation.errors.slice(0, 4).join(' ')
            )}</p>
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('download')} 导出</h2>
          </div>
          <div class="builder-actions">
            <button class="btn btn--ghost" type="button" data-action="export-builder-json">${icon(
              'file'
            )} 角色 JSON</button>
            <button class="btn btn--ghost" type="button" data-action="export-builder-md">${icon(
              'scroll'
            )} Markdown 人设卡</button>
            <button class="btn btn--ghost" type="button" data-action="back-to-characters">${icon(
              'arrow-right'
            )} 返回名册</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">${icon('book')} 规则提示</h2>
          </div>
          <ul class="rule-list">
            <li class="rule-item"><p class="rule-item__title">属性</p><p class="rule-item__text">STR/CON/DEX/APP/POW = 3D6×5；SIZ/INT/EDU = (2D6+6)×5。</p></li>
            <li class="rule-item"><p class="rule-item__title">年龄</p><p class="rule-item__text">15–19 / 40–49 / 50–59 / 60–69 / 70–79 / 80+ 各有调整；随机与 AI 车卡会自动应用。</p></li>
            <li class="rule-item"><p class="rule-item__title">技能点</p><p class="rule-item__text">职业点 = EDU×2，兴趣点 = INT×2；本职技能才能使用职业点。</p></li>
            <li class="rule-item"><p class="rule-item__title">上限</p><p class="rule-item__text">单项技能最高 99；信用评级必须在职业模板区间内。</p></li>
          </ul>
        </section>
      </aside>
    </div>`;
}

/* =========================================================
 * 角色档案
 * ========================================================= */

const ATTRIBUTES = ATTRIBUTE_META;

function bioBlock(label, value, { wide = false } = {}) {
  return `<div class="bio-block${wide ? ' bio-block--wide' : ''}">
    <span class="bio-block__label">${escapeHTML(label)}</span>
    <p class="bio-block__text">${escapeHTML(safeText(value, '未填写'))}</p>
  </div>`;
}

export function showCharacterSheet(id) {
  const character = storage.characters.get(id);
  if (!character) {
    toast('找不到这份角色档案。', { type: 'error' });
    return;
  }
  const hp = character.derived?.hp || {};
  const mp = character.derived?.mp || {};
  const san = character.derived?.san || {};
  const languages = character.languages?.length
    ? character.languages.map((language) => `${language.name} ${language.level}%`).join(' · ')
    : character.motherTongue;
  const skills = [...(character.skills || [])].sort((a, b) => b.total - a.total);
  const body = `
    <div class="sheet-head">
      <div class="sheet-head__portrait">${escapeHTML(getInitials(character.name))}</div>
      <div>
        <h3 class="sheet-head__name">
          ${escapeHTML(character.name)}
          <span class="tag ${character.kind === 'npc' ? 'tag--npc' : 'tag--pc'}">${
            character.kind === 'npc' ? 'NPC' : 'PL'
          }</span>
          ${character.isSample ? '<span class="tag">示例角色</span>' : ''}
        </h3>
        <p class="sheet-head__meta">${escapeHTML(
          [
            character.occupation,
            `${character.age} 岁`,
            character.gender,
            character.nationality,
            character.heightCm ? `${character.heightCm} cm` : '',
            character.weightKg ? `${character.weightKg} kg` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        )}</p>
        ${character.catchphrase ? `<p class="sheet-head__quote">“${escapeHTML(character.catchphrase)}”</p>` : ''}
      </div>
    </div>
    <section class="sheet-section">
      <h4 class="sheet-section__title">人物轮廓</h4>
      <div class="bio-grid">
        ${bioBlock('性格关键词', character.personality?.join(' · '))}
        ${bioBlock('母语与其他语言', languages)}
        ${bioBlock('外貌', character.appearance, { wide: true })}
        ${bioBlock('背景故事', character.background, { wide: true })}
      </div>
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">动机与羁绊</h4>
      <div class="bio-grid">
        ${bioBlock('加入调查的原因', character.joinReason, { wide: true })}
        ${bioBlock('重要之人', character.importantPerson)}
        ${bioBlock('信念 / 理念', character.ideology)}
        ${bioBlock('意义非凡之地', character.significantPlace)}
        ${bioBlock('宝贵之物', character.treasuredItem)}
        ${bioBlock('特质 / 缺陷', character.traits, { wide: true })}
        ${bioBlock('恐惧症 / 狂躁症', character.phobias, { wide: true })}
      </div>
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">详细角色设定</h4>
      ${
        character.detailedSetting
          ? `<details class="sheet-longtext"><summary>展开 ${character.detailedSetting.length} 字角色设定</summary><pre>${escapeHTML(
              character.detailedSetting
            )}</pre></details>`
          : '<p class="modal-copy muted">尚未填写详细角色设定。</p>'
      }
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">角色记忆</h4>
      ${
        character.memories?.length
          ? `<div class="memory-list">${character.memories
              .map(
                (memory) => `<article class="memory-item">
                  <div class="memory-item__head"><strong>${escapeHTML(
                    memory.moduleTitle || '未命名模组'
                  )}</strong><span class="panel__meta">${escapeHTML(
                    new Date(memory.createdAt).toLocaleDateString('zh-CN')
                  )}</span></div>
                  <p class="memory-item__summary">${escapeHTML(memory.summary)}</p>
                  ${
                    memory.keyEvents?.length
                      ? `<p class="memory-item__events">${memory.keyEvents
                          .map((event) => escapeHTML(event))
                          .join(' · ')}</p>`
                      : ''
                  }
                </article>`
              )
              .join('')}</div>`
          : '<p class="modal-copy muted">尚未获得跨模组记忆。</p>'
      }
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">属性与衍生值</h4>
      <div class="stat-pips">
        ${ATTRIBUTES.map(
          (attribute) => `<div class="stat-pip"><span class="stat-pip__label">${attribute.abbr}</span><span class="stat-pip__value">${escapeHTML(
            character.attributes?.[attribute.key] ?? '—'
          )}</span></div>`
        ).join('')}
      </div>
      <div class="derived-strip">
        <span class="derived-chip">HP <strong>${escapeHTML(hp.current ?? '—')} / ${escapeHTML(hp.max ?? '—')}</strong></span>
        <span class="derived-chip">MP <strong>${escapeHTML(mp.current ?? '—')} / ${escapeHTML(mp.max ?? '—')}</strong></span>
        <span class="derived-chip">SAN <strong>${escapeHTML(san.current ?? '—')} / ${escapeHTML(san.max ?? '—')}</strong></span>
        <span class="derived-chip">MOV <strong>${escapeHTML(character.derived?.mov ?? '—')}</strong></span>
        <span class="derived-chip">DB <strong>${escapeHTML(character.derived?.db ?? '—')}</strong></span>
        <span class="derived-chip">BUILD <strong>${escapeHTML(character.derived?.build ?? '—')}</strong></span>
        <span class="derived-chip">LUCK <strong>${escapeHTML(character.luck ?? '—')}</strong></span>
      </div>
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">技能</h4>
      ${
        skills.length
          ? `<div class="skill-cloud">${skills
              .map(
                (skill) =>
                  `<span class="skill-chip">${escapeHTML(skill.name)} <strong>${escapeHTML(
                    skill.total
                  )}</strong></span>`
              )
              .join('')}</div>`
          : '<p class="modal-copy muted">尚未记录技能。</p>'
      }
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">随身物品</h4>
      ${
        character.possessions?.length
          ? `<ul class="inventory-list">${character.possessions.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
          : '<p class="modal-copy muted">尚未记录随身物品。</p>'
      }
    </section>
    <section class="sheet-section">
      <h4 class="sheet-section__title">档案信息</h4>
      <div class="bio-grid">
        ${bioBlock('信用评级', character.creditRating)}
        ${bioBlock('技能点预算', `职业 ${character.occupationPoints} · 兴趣 ${character.interestPoints}`)}
        ${bioBlock('创建时间', formatDateTime(character.createdAt))}
        ${bioBlock('最后更新', formatDateTime(character.updatedAt))}
        ${bioBlock('备注', character.notes, { wide: true })}
      </div>
    </section>`;
  openModal({
    eyebrow: character.kind === 'npc' ? "Keeper's NPC" : 'Investigator Sheet',
    title: character.kind === 'npc' ? 'NPC 档案' : '调查员档案',
    body,
    footer: `<div class="modal-actions">
      <button class="btn btn--ghost" type="button" data-action="export-character" data-character-id="${escapeHTML(
        character.id
      )}">${icon('download')} 导出 JSON</button>
      <button class="btn btn--gold" type="button" data-action="edit-character" data-character-id="${escapeHTML(
        character.id
      )}">${icon('edit')} 编辑角色</button>
      <button class="btn btn--primary" type="button" data-close-dialog>关闭档案</button>
    </div>`,
  });
}

/* =========================================================
 * 表单实时更新
 * ========================================================= */

function parseLanguages(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s+(\d{1,3})\s*%?$/);
      if (!match) return { name: line, level: 0 };
      return { name: match[1].trim(), level: Math.max(0, Math.min(100, Number(match[2]))) };
    });
}

function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function updateComputedDom() {
  syncDraft(draft);
  const validation = validateBuild(getBuild(draft));
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = String(value);
  };
  setText('[data-derived="hp"]', `${draft.derived.hp.current} / ${draft.derived.hp.max}`);
  setText('[data-derived="mp"]', `${draft.derived.mp.current} / ${draft.derived.mp.max}`);
  setText('[data-derived="san"]', `${draft.derived.san.current} / ${draft.derived.san.max}`);
  setText('[data-derived="mov"]', draft.derived.mov);
  setText('[data-derived="db"]', draft.derived.db);
  setText('[data-derived="build"]', draft.derived.build);
  setText('[data-budget-occupation]', draft.occupationPoints);
  setText('[data-budget-interest]', draft.interestPoints);
  setText('[data-spent-occupation]', draft.pointsSpent.occupation);
  setText('[data-spent-interest]', draft.pointsSpent.interest);
  setText(
    '[data-budget-label-occupation]',
    `${draft.pointsSpent.occupation} / ${draft.occupationPoints}`
  );
  setText('[data-budget-label-interest]', `${draft.pointsSpent.interest} / ${draft.interestPoints}`);
  const occMeter = document.querySelector('[data-meter-occupation]');
  const intMeter = document.querySelector('[data-meter-interest]');
  if (occMeter) {
    occMeter.style.width = `${Math.min(
      100,
      (draft.pointsSpent.occupation / Math.max(1, draft.occupationPoints)) * 100
    )}%`;
  }
  if (intMeter) {
    intMeter.style.width = `${Math.min(
      100,
      (draft.pointsSpent.interest / Math.max(1, draft.interestPoints)) * 100
    )}%`;
  }
  draft.skills.forEach((skill, index) => {
    const inputOcc = document.querySelector(`[data-skill-index="${index}"][data-skill-part="occupation"]`);
    const inputInt = document.querySelector(`[data-skill-index="${index}"][data-skill-part="interest"]`);
    if (inputOcc) inputOcc.value = skill.occupation;
    if (inputInt) inputInt.value = skill.interest;
    setText(`[data-skill-total="${index}"]`, skill.total);
  });
  const box = document.querySelector('[data-validation-box]');
  if (box) {
    box.classList.toggle('is-valid', validation.valid);
    box.classList.toggle('is-invalid', !validation.valid);
    box.innerHTML = `<strong>${validation.valid ? '规则校验通过' : '需要修正'}</strong><p>${escapeHTML(
      validation.valid
        ? validation.warnings.slice(0, 3).join(' ') || '点数、属性与信用评级均在允许范围内。'
        : validation.errors.slice(0, 4).join(' ')
    )}</p>`;
  }
}

function bindBuilderForm(ctx) {
  const form = document.getElementById('builder-form');
  if (!form) return;

  form.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    if (target.dataset.attr) {
      draft.attributes[target.dataset.attr] = Number(target.value) || 1;
      updateComputedDom();
      return;
    }
    if (target.dataset.skillIndex !== undefined && target.dataset.skillPart) {
      const index = Number(target.dataset.skillIndex);
      const skill = draft.skills[index];
      if (!skill) return;
      skill[target.dataset.skillPart] = Math.max(0, Number(target.value) || 0);
      syncDraft(draft);
      updateComputedDom();
      return;
    }
    if (target.dataset.field) {
      const key = target.dataset.field;
      if (key === 'personality') {
        draft.personality = String(target.value)
          .split(/[、,，]/)
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (key === 'languages') {
        draft.languages = parseLanguages(target.value);
      } else if (key === 'possessions') {
        draft.possessions = parseLines(target.value);
      } else if (['age', 'heightCm', 'weightKg', 'creditRating', 'luck'].includes(key)) {
        draft[key] = Number(target.value) || 0;
        if (key === 'creditRating') syncCreditSkill(draft);
      } else {
        draft[key] = target.value;
      }
      if (key === 'age') {
        // 年龄改变只影响派生 MOV 与预算；属性不会自动回滚，避免反复加减。
        draft.derived = calculateDerived(draft.attributes, draft.age);
      }
      updateComputedDom();
    }
  });

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.hasAttribute('data-occupation')) {
      draft.occupationId = target.value;
      draft.occupation = getOccupation(target.value).name;
      draft.skills = createSkillList(target.value, draft.attributes, []);
      syncCreditSkill(draft);
      syncDraft(draft);
      ctx.refresh();
    }
  });
}

/* =========================================================
 * 操作
 * ========================================================= */

const sampleIds = new Set(['pc_sample_lin_moqiu', 'pc_sample_zhou_yan']);

async function loadSamples() {
  const { createSampleCharacters } = await import('../sample-data.js');
  const samples = createSampleCharacters();
  let added = 0;
  for (const sample of samples) {
    if (!storage.characters.get(sample.id)) {
      storage.characters.save(sample);
      added += 1;
    }
  }
  toast(added ? `已载入 ${added} 位示例调查员。` : '示例调查员已经在名册中。', {
    type: added ? 'success' : 'info',
  });
}

function builderPersona() {
  return {
    ...draft,
    personality: draft.personality,
    languages: draft.languages,
    possessions: draft.possessions,
  };
}

function ensureValidForSave() {
  syncDraft(draft);
  const errors = [];
  if (!String(draft.name || '').trim()) errors.push('姓名不能为空。');
  const validation = validateBuild(getBuild(draft));
  errors.push(...validation.errors);
  if (errors.length) {
    openModal({
      eyebrow: '无法保存',
      title: '角色卡未通过规则校验',
      body: `<p class="modal-copy">请修正以下问题后再保存：</p><ul class="modal-list">${errors
        .map((error) => `<li>${escapeHTML(error)}</li>`)
        .join('')}</ul>`,
      footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>返回修改</button></div>`,
    });
    return null;
  }
  draft.name = String(draft.name).trim();
  return validation;
}

function buildCharacterForExport() {
  syncDraft(draft);
  const character = applyBuildToCharacter(draft, getBuild(draft));
  character.name = String(draft.name || '未命名调查员').trim();
  return character;
}

export const characterView = {
  renderList() {
    return renderCharacterList();
  },

  async mountList(ctx) {
    const input = document.getElementById('character-import');
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const character = storage.characters.importJSON(text);
        toast(`${character.name} 已导入。`, { type: 'success' });
        ctx.refresh();
      } catch (error) {
        toast(error.message, { type: 'error', duration: 6000 });
      } finally {
        input.value = '';
      }
    });
  },

  renderBuilder(query) {
    ensureDraft(query);
    return `<form id="builder-form">${renderBuilder()}</form>`;
  },

  async mountBuilder(ctx) {
    ensureDraft(ctx.query);
    bindBuilderForm(ctx);
  },

  actions: {
    async 'new-character'(element, ctx) {
      draft = null;
      editingId = '';
      aiStatus = '';
      closeModal();
      ctx.navigate('#/builder');
    },

    async 'edit-character'(element, ctx) {
      const character = storage.characters.get(element.dataset.characterId);
      if (!character) return toast('角色不存在。', { type: 'error' });
      closeModal();
      draft = characterToDraft(character);
      editingId = character.id;
      aiStatus = `正在编辑：${character.name}`;
      ctx.navigate('#/builder');
    },

    async 'view-character'(element) {
      showCharacterSheet(element.dataset.characterId);
    },

    async 'delete-character'(element, ctx) {
      const character = storage.characters.get(element.dataset.characterId);
      if (!character) return;
      const ok = await confirmDialog({
        eyebrow: '删除角色档案',
        title: `真的要删除 ${character.name} 吗？`,
        message: '这会移除整份角色卡，包括人设、属性、技能与笔记，且无法撤销。建议先导出 JSON。',
        confirmLabel: '删除档案',
        danger: true,
      });
      if (!ok) return;
      storage.characters.remove(character.id);
      if (editingId === character.id) {
        draft = null;
        editingId = '';
      }
      toast('角色档案已删除。', { type: 'success' });
      ctx.refresh();
    },

    async 'export-character'(element) {
      const json = storage.characters.exportJSON(element.dataset.characterId);
      const character = storage.characters.get(element.dataset.characterId);
      downloadFile(`${sanitizeFilename(character?.name, 'investigator')}-调查员.json`, json);
      toast('角色 JSON 已导出。', { type: 'success' });
    },

    async 'load-sample'(element, ctx) {
      await loadSamples();
      ctx.refresh();
    },

    async 'import-character'(element) {
      const input = document.getElementById('character-import');
      if (!input) return toast('导入控件未就绪。', { type: 'error' });
      input.click();
    },

    async 'randomize-character'(element, ctx) {
      draft = randomizeDraft(draft);
      syncDraft(draft);
      aiStatus = '已按年龄修正随机骰点，请分配技能点。';
      ctx.refresh();
    },

    async 'auto-build-character'(element, ctx) {
      if (aiBusy) return;
      if (!String(draft.name || '').trim()) {
        return toast('请先填写姓名，再让 AI 按人设车卡。', { type: 'warning' });
      }
      const profile = storage.settings.getActiveApiProfile();
      if (!profile) {
        return toast('尚未配置 AI 接口。请先到「设置与接口」添加一套配置。', {
          type: 'error',
          duration: 6000,
        });
      }
      aiBusy = true;
      const status = document.querySelector('[data-ai-status]');
      const button = element;
      button.disabled = true;
      button.textContent = 'AI 车卡中…';
      if (status) status.textContent = `正在调用 ${profile.name} / ${profile.model}…`;
      try {
        const result = await generateCharacterWithAI({
          persona: builderPersona(),
          occupationId: draft.occupationId,
          age: draft.age,
          maxRetries: 2,
          onAttempt: (attempt, total) => {
            if (status) status.textContent = `第 ${attempt} / ${total} 次尝试：生成并分配总点数…`;
          },
          callModel: async (messages) => {
            const completion = await api.complete(profile, messages, {
              useWebSearch: Boolean(profile.webSearch?.enabled),
              retries: 1,
            });
            return completion.content;
          },
        });
        draft = applyBuildToCharacter(draft, result.build);
        syncDraft(draft);
        const totals = result.validation?.totals;
        aiStatus = totals
          ? `AI 车卡完成（${result.attempts} 次尝试）：职业点 ${totals.occupationSpent}/${totals.occupationBudget}，兴趣点 ${totals.interestSpent}/${totals.interestBudget}，已按总预算精确分配。`
          : `AI 车卡完成（${result.attempts} 次尝试），已应用年龄修正与规则校验。`;
        toast(
          totals
            ? `AI 车卡完成：职业点 ${totals.occupationSpent}/${totals.occupationBudget}，兴趣点 ${totals.interestSpent}/${totals.interestBudget}。`
            : 'AI 车卡完成，已写入工作台。',
          { type: 'success' }
        );
        ctx.refresh();
      } catch (error) {
        aiStatus = `AI 车卡失败：${error.message}`;
        if (status) status.textContent = aiStatus;
        const details = error.details?.length
          ? `<ul class="modal-list">${error.details.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
          : '';
        openModal({
          eyebrow: 'AI 车卡失败',
          title: '模型输出未通过规则校验',
          body: `<p class="modal-copy">${escapeHTML(error.message)}</p>${details}<p class="modal-copy">你的输入没有被覆盖，可以修改人设或接口后重试。</p>`,
          footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>知道了</button></div>`,
        });
      } finally {
        aiBusy = false;
        if (document.body.contains(button)) {
          button.disabled = false;
          button.innerHTML = `${icon('spark')} 按人设自动车卡`;
        }
      }
    },

    async 'save-character'(element, ctx) {
      const validation = ensureValidForSave();
      if (!validation) return;
      const character = applyBuildToCharacter(draft, getBuild(draft));
      character.name = draft.name;
      const saved = storage.characters.save(character);
      editingId = saved.id;
      draft = characterToDraft(saved);
      toast(`${saved.name} 已保存。${validation.warnings.length ? ` ${validation.warnings[0]}` : ''}`, {
        type: 'success',
        duration: 4800,
      });
      ctx.navigate('#/characters');
    },

    async 'open-skill-picker'(element, ctx) {
      const body = document.createElement('div');
      body.innerHTML = `<div class="skill-picker">
        <div class="skill-picker__filters">
          <label class="form-field">
            <span class="form-field__label">搜索技能</span>
            <input class="form-input" id="skill-picker-search" placeholder="侦查、科学、射击、语言……">
          </label>
          <label class="form-field">
            <span class="form-field__label">分类</span>
            <select class="form-input" id="skill-picker-category">
              <option value="all">全部技能</option>
              ${SKILL_CATEGORIES.map(
                (category) =>
                  `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`
              ).join('')}
            </select>
          </label>
        </div>
        <p class="form-help">带子类的技能会要求填写学科、语种、环境、载具或武器类型；添加后仍可分配职业点/兴趣点。</p>
        <div class="skill-picker__detail" id="skill-picker-detail" hidden>
          <label class="form-field">
            <span class="form-field__label" id="skill-detail-label">子类</span>
            <input class="form-input" id="skill-detail-input">
          </label>
          <div class="skill-picker__detail-actions">
            <button class="btn btn--ghost btn--sm" type="button" data-cancel-skill-detail>取消</button>
            <button class="btn btn--primary btn--sm" type="button" data-confirm-skill-detail>添加</button>
          </div>
        </div>
        <div class="skill-picker__list" id="skill-picker-list">${renderSkillPickerList()}</div>
      </div>`;
      openModal({
        eyebrow: 'Skill Catalog',
        title: '从技能表添加',
        body,
        wide: true,
        footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>关闭</button></div>`,
        onMount: (dialog) => {
          const list = dialog.querySelector('#skill-picker-list');
          const paint = () => {
            if (!list) return;
            list.innerHTML = renderSkillPickerList(
              dialog.querySelector('#skill-picker-search')?.value || '',
              dialog.querySelector('#skill-picker-category')?.value || 'all'
            );
          };
          let pendingEntry = null;
          const detailPanel = dialog.querySelector('#skill-picker-detail');
          const detailInput = dialog.querySelector('#skill-detail-input');
          const detailLabel = dialog.querySelector('#skill-detail-label');
          const addSkill = (name, preferredBase) => {
            if (draft.skills.some((skill) => skill.name === name)) {
              toast(`「${name}」已经在技能表里了。`, { type: 'info' });
              return false;
            }
            const base = baseSkillValue(name, draft.attributes) || preferredBase || 1;
            draft.skills.push({
              name,
              base,
              occupation: 0,
              interest: 0,
              total: base,
              checked: false,
            });
            closeModal();
            ctx.refresh();
            toast(`已添加「${name}」，基础值 ${base}%。`, { type: 'success' });
            return true;
          };
          const showDetail = (entry) => {
            pendingEntry = entry;
            if (detailLabel) detailLabel.textContent = `请填写${entry.detail}`;
            if (detailInput) {
              detailInput.value = '';
              detailInput.placeholder = entry.detailPlaceholder || '自定义';
              detailInput.focus();
            }
            if (detailPanel) detailPanel.hidden = false;
          };
          const hideDetail = () => {
            pendingEntry = null;
            if (detailPanel) detailPanel.hidden = true;
          };
          dialog.querySelector('#skill-picker-search')?.addEventListener('input', paint);
          dialog.querySelector('#skill-picker-category')?.addEventListener('change', paint);
          dialog.querySelector('[data-cancel-skill-detail]')?.addEventListener('click', hideDetail);
          dialog.querySelector('[data-confirm-skill-detail]')?.addEventListener('click', () => {
            if (!pendingEntry) return;
            const clean = String(detailInput?.value || '').trim();
            if (!clean) {
              toast(`请填写${pendingEntry.detail}。`, { type: 'warning' });
              detailInput?.focus();
              return;
            }
            const baseName =
              pendingEntry.detailMode === 'language'
                ? '语言'
                : pendingEntry.name.replace(/（其他）$/, '');
            addSkill(`${baseName}（${clean}）`, pendingEntry.base);
          });
          detailInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              dialog.querySelector('[data-confirm-skill-detail]')?.click();
            }
          });
          list?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-add-catalog-skill]');
            if (!button) return;
            const entry = SKILL_CATALOG[Number(button.dataset.addCatalogSkill)];
            if (!entry) return;
            if (entry.detail) {
              showDetail(entry);
              return;
            }
            addSkill(entry.name, entry.base);
          });
        },
      });
      setTimeout(() => document.getElementById('skill-picker-search')?.focus(), 50);
    },

    async 'remove-skill'(element, ctx) {
      const index = Number(element.dataset.skillIndex);
      const skill = draft.skills[index];
      if (!skill) return;
      if (['母语', '闪避', '信用评级'].includes(skill.name)) {
        return toast('母语、闪避与信用评级是车卡必需项，不能移除。', { type: 'info' });
      }
      draft.skills.splice(index, 1);
      ctx.refresh();
      toast(`已移除「${skill.name}」。`, { type: 'info' });
    },

    async 'add-custom-skill'(element, ctx) {
      const body = document.createElement('div');
      body.innerHTML = `<label class="form-field"><span class="form-field__label">技能名称</span><input class="form-input" id="custom-skill-name" placeholder="例如：航海"></label>`;
      openModal({
        eyebrow: '自定义技能',
        title: '添加一项技能',
        body,
        footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>取消</button><button class="btn btn--primary" type="button" data-custom-skill-confirm>添加</button></div>`,
        onMount: (dialog) => {
          dialog.querySelector('[data-custom-skill-confirm]')?.addEventListener('click', () => {
            const input = dialog.querySelector('#custom-skill-name');
            const name = String(input?.value || '').trim();
            if (!name) return toast('技能名称不能为空。', { type: 'error' });
            if (draft.skills.some((skill) => skill.name === name)) {
              return toast('这个技能已经存在。', { type: 'error' });
            }
            draft.skills.push({
              name,
              base: baseSkillValue(name, draft.attributes),
              occupation: 0,
              interest: 0,
              total: baseSkillValue(name, draft.attributes),
              checked: false,
            });
            closeModal();
            ctx.refresh();
          });
        },
      });
      setTimeout(() => document.getElementById('custom-skill-name')?.focus(), 50);
    },

    async 'apply-occupation'(element, ctx) {
      draft.skills = createSkillList(draft.occupationId, draft.attributes, draft.skills);
      syncCreditSkill(draft);
      syncDraft(draft);
      toast('已按当前职业重载技能模板，原有技能点保留。', { type: 'info' });
      ctx.refresh();
    },

    async 'export-builder-json'(element) {
      const character = buildCharacterForExport();
      const payload = {
        format: 'cthulhu-table.character',
        version: 1,
        exportedAt: new Date().toISOString(),
        character,
      };
      downloadFile(`${sanitizeFilename(character.name, 'investigator')}-调查员.json`, JSON.stringify(payload, null, 2));
      toast('角色 JSON 已导出（未保存修改也会包含）。', { type: 'success' });
    },

    async 'export-builder-md'(element) {
      const character = buildCharacterForExport();
      downloadFile(
        `${sanitizeFilename(character.name, 'investigator')}-人设卡.md`,
        characterToMarkdown(character),
        'text/markdown;charset=utf-8'
      );
      toast('Markdown 人设卡已导出。', { type: 'success' });
    },

    async 'back-to-characters'(element, ctx) {
      ctx.navigate('#/characters');
    },
  },
};

export default characterView;
