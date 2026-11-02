/**
 * app.js — 应用入口、Hash 路由、页面骨架与首屏交互
 *
 * 第一阶段只实现：
 * - 单页 Hash 路由（GitHub Pages 友好，无需服务端重写）
 * - 响应式应用外壳与六个页面骨架
 * - 示例调查员载入、角色档案预览、角色 JSON 导出/删除
 * - 设置页的本地存储自检、减少动效开关、完整备份导出
 *
 * 具体的车卡、骰子、API、模组与 KP 流程分别在第二至第六阶段接入。
 */

import { storage } from './storage.js';
import { createSampleCharacters } from './sample-data.js';
import {
  escapeHTML,
  safeText,
  icon,
  getInitials,
  formatDate,
  formatDateTime,
  formatRelative,
  formatBytes,
  formatNumber,
  toast,
  openModal,
  closeModal,
  confirmDialog,
  downloadFile,
  sanitizeFilename,
} from './ui.js';

const view = document.getElementById('main-content');
const topbarTitle = document.getElementById('topbar-title');
const sidebar = document.getElementById('sidebar');
const menuButton = document.querySelector('[data-action="open-nav"]');
const bootScreen = document.getElementById('boot-screen');
const bootNote = document.getElementById('boot-note');
const bootHint = document.getElementById('file-protocol-hint');
const bootStartedAt = performance.now();

let currentPath = '/home';

/* =========================================================
 * 小型模板工具
 * ========================================================= */

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value);
}

function pageHead({ kicker, title, lede, actions = '' }) {
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

function emptyState({ title, text, actions = '' }) {
  return `
    <div class="empty-state">
      <img class="empty-state__sigil" src="assets/sigil.svg" alt="" aria-hidden="true">
      <h2 class="empty-state__title">${escapeHTML(title)}</h2>
      <p class="empty-state__text">${escapeHTML(text)}</p>
      ${actions ? `<div class="empty-state__actions">${actions}</div>` : ''}
    </div>`;
}

function stageBadge(stage, label = '') {
  return `<span class="stage-badge"><span class="stage-badge__dot"></span>${escapeHTML(
    label || `第 ${stage} 阶段`
  )}</span>`;
}

/* =========================================================
 * 首页
 * ========================================================= */

function renderHome() {
  const characters = storage.characters.list();
  const settings = storage.settings.get();
  const recent = characters.slice(0, 3);
  const apiCount = settings.api.profiles.length;

  const recentMarkup = recent.length
    ? `<div class="recent-list">
        ${recent
          .map(
            (character) => `
          <button class="recent-item" type="button" data-action="view-character" data-character-id="${escapeHTML(
            character.id
          )}">
            <span class="recent-item__portrait">${escapeHTML(getInitials(character.name))}</span>
            <span class="recent-item__body">
              <span class="recent-item__name">${escapeHTML(character.name)}</span>
              <span class="recent-item__meta">${escapeHTML(
                [character.occupation, `${character.age} 岁`, character.gender]
                  .filter(Boolean)
                  .join(' · ')
              )}</span>
            </span>
            <span class="recent-item__side">${escapeHTML(formatRelative(character.updatedAt))}${icon(
              'arrow-up-right',
              'icon--sm'
            )}</span>
          </button>`
          )
          .join('')}
      </div>`
    : `
      <div class="empty-state empty-state--compact">
        <p class="empty-state__text">名册还是空的。载入两位示例调查员，先看看一张完整的人设卡长什么样。</p>
        <div class="empty-state__actions">
          <button class="btn btn--gold btn--sm" type="button" data-action="load-sample">
            ${icon('spark')} 载入示例
          </button>
          <a class="btn btn--ghost btn--sm" href="#/builder">前往车卡工坊</a>
        </div>
      </div>`;

  return `
    <section class="home-hero">
      <div class="hero__copy">
        <p class="eyebrow">克苏鲁的呼唤 · 第七版</p>
        <h1 class="hero__title">在不可名状的<br><em>边缘</em>，保持理智。</h1>
        <p class="hero__lede">
          一位 AI 守秘人，一份只属于你的模组，一桌永远亮着煤油灯的调查员。
          所有角色、骰子与对话都留在本地——这里没有服务器在听。
        </p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#/modules">
            ${icon('book')} 选择一份模组 ${icon('arrow-right')}
          </a>
          <button class="btn btn--ghost" type="button" data-action="load-sample">
            ${icon('users')} 载入示例调查员
          </button>
        </div>
        <div class="hero__meta">
          <span>${icon('shield')} 无后端 · 本地优先</span>
          <span>${icon('dice')} COC 7TH</span>
          <span>${icon('key')} 自定义 AI 接口</span>
        </div>
      </div>
      <div class="hero__oracle" aria-hidden="true">
        <div class="oracle-rings">
          <span class="oracle-rune"></span>
          <span class="oracle-rune"></span>
          <span class="oracle-rune"></span>
          <span class="oracle-rune"></span>
        </div>
        <img class="oracle-sigil" src="assets/sigil.svg" alt="">
        <span class="oracle-mark oracle-mark--left">ARKHAM · 1928</span>
        <span class="oracle-mark oracle-mark--right">KEEP THE SECRET</span>
        <p class="oracle-caption">The secret must be kept</p>
      </div>
    </section>

    <section class="stat-grid" aria-label="战役数据概览">
      <article class="stat-card">
        <span class="stat-card__icon">${icon('users')}</span>
        <span class="stat-card__body">
          <span class="stat-card__value" data-stat="characters">${formatNumber(characters.length)}</span>
          <span class="stat-card__label">调查员档案</span>
          <span class="stat-card__hint">PL 与 NPC 共用同一套数据结构</span>
        </span>
      </article>
      <article class="stat-card">
        <span class="stat-card__icon">${icon('book')}</span>
        <span class="stat-card__body">
          <span class="stat-card__value stat-card__value--empty" data-stat="modules">—</span>
          <span class="stat-card__label">本地模组</span>
          <span class="stat-card__hint">文本只写入 IndexedDB</span>
        </span>
      </article>
      <article class="stat-card">
        <span class="stat-card__icon">${icon('table')}</span>
        <span class="stat-card__body">
          <span class="stat-card__value stat-card__value--empty" data-stat="chats">—</span>
          <span class="stat-card__label">对话记录</span>
          <span class="stat-card__hint">按战役与场景分组归档</span>
        </span>
      </article>
    </section>

    <div class="home-grid">
      <section class="panel" aria-labelledby="recent-title">
        <div class="panel__head">
          <h2 class="panel__title" id="recent-title">${icon('scroll')} 最近的调查员</h2>
          <a class="section-head__link" href="#/characters">全部名册 ${icon('arrow-right')}</a>
        </div>
        ${recentMarkup}
      </section>

      <aside class="panel" aria-labelledby="preflight-title">
        <div class="panel__head">
          <h2 class="panel__title" id="preflight-title">${icon('clock')} 开团准备</h2>
          <span class="panel__meta">3 STEPS</span>
        </div>
        <ol class="preflight">
          <li class="preflight__item">
            <span class="preflight__index">01</span>
            <div class="preflight__body">
              <p class="preflight__title">调查员就位</p>
              <p class="preflight__desc">${
                characters.length
                  ? `已有 ${characters.length} 份档案，可以开始整理人设。`
                  : '载入示例或前往车卡工坊创建第一份档案。'
              }</p>
            </div>
            <span class="preflight__status">${characters.length ? 'READY' : 'WAIT'}</span>
          </li>
          <li class="preflight__item">
            <span class="preflight__index">02</span>
            <div class="preflight__body">
              <p class="preflight__title">模组进入档案柜</p>
              <p class="preflight__desc">导入 .txt / .md / .json，切分章节、场景与线索。</p>
            </div>
            <span class="preflight__status">STAGE 5</span>
          </li>
          <li class="preflight__item">
            <span class="preflight__index">03</span>
            <div class="preflight__body">
              <p class="preflight__title">连接守秘人</p>
              <p class="preflight__desc">${
                apiCount ? `已保存 ${apiCount} 套接口配置。` : '配置一个 OpenAI 兼容接口，开启 AI KP。'
              }</p>
            </div>
            <span class="preflight__status">${apiCount ? 'READY' : 'STAGE 3'}</span>
          </li>
        </ol>
      </aside>
    </div>`;
}

async function mountHome() {
  const stats = await storage.diagnostics.stats();
  if (!document.querySelector('[data-stat="modules"]')) return;
  setText('[data-stat="characters"]', formatNumber(stats.characters));
  setText('[data-stat="modules"]', formatNumber(stats.modules));
  setText('[data-stat="chats"]', formatNumber(stats.chats));
  const moduleStat = document.querySelector('[data-stat="modules"]');
  const chatStat = document.querySelector('[data-stat="chats"]');
  if (moduleStat) moduleStat.classList.toggle('stat-card__value--empty', stats.modules === 0);
  if (chatStat) chatStat.classList.toggle('stat-card__value--empty', stats.chats === 0);
}

/* =========================================================
 * 调查员名册
 * ========================================================= */

function renderCharacterCard(character) {
  const hp = character.derived?.hp || { current: '—', max: '—' };
  const san = character.derived?.san || { current: '—', max: '—' };
  const mov = character.derived?.mov ?? '—';
  const quote = character.catchphrase
    ? `“${character.catchphrase}”`
    : character.personality.length
      ? character.personality.slice(0, 3).join(' · ')
      : '尚未留下口头禅。';
  const meta = [character.age ? `${character.age} 岁` : '', character.gender, character.occupation]
    .filter(Boolean)
    .join(' · ');

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
          <p class="character-card__meta">${escapeHTML(meta || '身份未填写')}</p>
        </div>
      </div>
      <p class="character-card__quote">${escapeHTML(quote)}</p>
      <div class="character-card__vitals">
        <div class="vital">
          <span class="vital__label">HP</span>
          <span class="vital__value">${escapeHTML(hp.current)}<small> / ${escapeHTML(hp.max)}</small></span>
        </div>
        <div class="vital">
          <span class="vital__label">SAN</span>
          <span class="vital__value">${escapeHTML(san.current)}<small> / ${escapeHTML(san.max)}</small></span>
        </div>
        <div class="vital">
          <span class="vital__label">MOV</span>
          <span class="vital__value">${escapeHTML(mov)}</span>
        </div>
      </div>
      <div class="character-card__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-action="view-character" data-character-id="${escapeHTML(
          character.id
        )}">
          ${icon('file')} 查看档案
        </button>
        <span class="faint">${escapeHTML(formatRelative(character.updatedAt))}</span>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-character" data-character-id="${escapeHTML(
          character.id
        )}" aria-label="删除 ${escapeHTML(character.name)}" title="删除档案">
          ${icon('trash', 'icon--sm')}
        </button>
      </div>
    </article>`;
}

function renderCharacters() {
  const characters = storage.characters.list();
  const sampleCount = characters.filter((character) => character.isSample).length;
  const actions = `
    <a class="btn btn--primary" href="#/builder">${icon('wand')} 按人设自动车卡</a>
    <button class="btn btn--ghost" type="button" data-action="load-sample">
      ${icon('spark')} ${sampleCount ? '补齐示例' : '载入示例'}
    </button>`;

  return `
    ${pageHead({
      kicker: 'Investigator Archive',
      title: '调查员名册',
      lede: '玩家调查员与守秘人 NPC 共用同一份人设结构。完整档案包括背景、动机、羁绊、恐惧，以及一张经得起规则校验的角色卡。',
      actions,
    })}
    ${
      characters.length
        ? `<div class="char-grid">${characters.map(renderCharacterCard).join('')}</div>`
        : emptyState({
            title: '名册上还没有名字',
            text: '在进入阿卡姆之前，总得先知道自己是谁。载入两位示例调查员，或从前方的车卡工坊开始。',
            actions: `
              <button class="btn btn--gold" type="button" data-action="load-sample">${icon(
                'spark'
              )} 载入示例调查员</button>
              <a class="btn btn--ghost" href="#/builder">了解自动车卡</a>`,
          })
    }`;
}

/* =========================================================
 * 角色档案弹窗
 * ========================================================= */

const ATTRIBUTES = [
  { key: 'str', abbr: 'STR', label: '力量' },
  { key: 'con', abbr: 'CON', label: '体质' },
  { key: 'siz', abbr: 'SIZ', label: '体型' },
  { key: 'dex', abbr: 'DEX', label: '敏捷' },
  { key: 'app', abbr: 'APP', label: '外貌' },
  { key: 'int', abbr: 'INT', label: '智力' },
  { key: 'pow', abbr: 'POW', label: '意志' },
  { key: 'edu', abbr: 'EDU', label: '教育' },
];

function bioBlock(label, value, { wide = false } = {}) {
  return `
    <div class="bio-block${wide ? ' bio-block--wide' : ''}">
      <span class="bio-block__label">${escapeHTML(label)}</span>
      <p class="bio-block__text">${escapeHTML(safeText(value, '未填写'))}</p>
    </div>`;
}

function openCharacterSheet(id) {
  const character = storage.characters.get(id);
  if (!character) {
    toast('找不到这份角色档案，它可能已被删除。', { type: 'error' });
    return;
  }

  const attributes = character.attributes || {};
  const derived = character.derived || {};
  const hp = derived.hp || {};
  const mp = derived.mp || {};
  const san = derived.san || {};
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
            character.occupation || '职业未填写',
            character.age ? `${character.age} 岁` : '',
            character.gender,
            character.nationality,
            character.heightCm ? `${character.heightCm} cm` : '',
            character.weightKg ? `${character.weightKg} kg` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        )}</p>
        ${
          character.catchphrase
            ? `<p class="sheet-head__quote">“${escapeHTML(character.catchphrase)}”</p>`
            : ''
        }
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
      <h4 class="sheet-section__title">属性与衍生值</h4>
      <div class="stat-pips">
        ${ATTRIBUTES.map(
          (attribute) => `
          <div class="stat-pip">
            <span class="stat-pip__label">${attribute.abbr}</span>
            <span class="stat-pip__value">${escapeHTML(attributes[attribute.key] ?? '—')}</span>
          </div>`
        ).join('')}
      </div>
      <div class="derived-strip">
        <span class="derived-chip">HP <strong>${escapeHTML(hp.current ?? '—')} / ${escapeHTML(
          hp.max ?? '—'
        )}</strong></span>
        <span class="derived-chip">MP <strong>${escapeHTML(mp.current ?? '—')} / ${escapeHTML(
          mp.max ?? '—'
        )}</strong></span>
        <span class="derived-chip">SAN <strong>${escapeHTML(san.current ?? '—')} / ${escapeHTML(
          san.max ?? '—'
        )}</strong></span>
        <span class="derived-chip">MOV <strong>${escapeHTML(derived.mov ?? '—')}</strong></span>
        <span class="derived-chip">DB <strong>${escapeHTML(derived.db ?? '—')}</strong></span>
        <span class="derived-chip">BUILD <strong>${escapeHTML(derived.build ?? '—')}</strong></span>
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
          ? `<ul class="inventory-list">${character.possessions
              .map((item) => `<li>${escapeHTML(item)}</li>`)
              .join('')}</ul>`
          : '<p class="modal-copy muted">尚未记录随身物品。</p>'
      }
    </section>

    <section class="sheet-section">
      <h4 class="sheet-section__title">档案信息</h4>
      <div class="bio-grid">
        ${bioBlock('信用评级', character.creditRating)}
        ${bioBlock(
          '技能点预算',
          `职业 ${character.occupationPoints} · 兴趣 ${character.interestPoints}`
        )}
        ${bioBlock('创建时间', formatDateTime(character.createdAt))}
        ${bioBlock('最后更新', formatDateTime(character.updatedAt))}
        ${bioBlock('备注', character.notes, { wide: true })}
      </div>
    </section>`;

  const footer = `
    <div class="modal-actions">
      <button class="btn btn--ghost" type="button" data-action="export-character" data-character-id="${escapeHTML(
        character.id
      )}">${icon('download')} 导出 JSON</button>
      <button class="btn btn--primary" type="button" data-close-dialog>关闭档案</button>
    </div>`;

  openModal({
    eyebrow: character.kind === 'npc' ? 'Keeper\'s NPC' : 'Investigator Sheet',
    title: character.kind === 'npc' ? 'NPC 档案' : '调查员档案',
    body,
    footer,
  });
}

/* =========================================================
 * 车卡工坊骨架
 * ========================================================= */

function renderBuilder() {
  const attributes = [
    ['STR', '力量', '3D6 × 5'],
    ['CON', '体质', '3D6 × 5'],
    ['SIZ', '体型', '(2D6 + 6) × 5'],
    ['DEX', '敏捷', '3D6 × 5'],
    ['APP', '外貌', '3D6 × 5'],
    ['INT', '智力', '(2D6 + 6) × 5'],
    ['POW', '意志', '3D6 × 5'],
    ['EDU', '教育', '(2D6 + 6) × 5'],
  ];

  return `
    ${pageHead({
      kicker: 'Investigator Workshop',
      title: '车卡工坊',
      lede: '把人设交给规则，而不是交给随机数。第二阶段先完成 CoC 7e 规则引擎、手工分配与随机骰点；第三阶段接入 AI 人设解析与严格 JSON 校验，形成完整流水线。',
      actions: `<a class="btn btn--ghost" href="#/characters">${icon(
        'users'
      )} 返回名册</a> ${stageBadge(3, '第 2–3 阶段')}`,
    })}

    <div class="info-strip">
      ${icon('spark')}
      <span><strong>当前为第一阶段界面骨架。</strong> 下方展示最终工作台的布局与规则口径；随机骰点与规则校验在第二阶段实现，AI 一键车卡在第三阶段接入，不使用静态假按钮。</span>
    </div>

    <div class="workspace-grid" style="margin-top: 22px;">
      <section class="panel" aria-labelledby="attribute-board-title">
        <div class="panel__head">
          <h2 class="panel__title" id="attribute-board-title">${icon('dice')} 属性分配预览</h2>
          <span class="panel__meta">COC 7E · 8 ATTRIBUTES</span>
        </div>
        <div class="attribute-board">
          ${attributes
            .map(
              ([abbr, name, formula]) => `
            <div class="attr-tile">
              <div class="attr-tile__head">
                <span class="attr-tile__abbr">${abbr}</span>
                <span class="attr-tile__name">${name}</span>
              </div>
              <span class="attr-tile__value">—</span>
              <span class="attr-tile__formula">${formula}</span>
            </div>`
            )
            .join('')}
        </div>
        <div class="derived-grid">
          <div class="derived-tile"><span class="derived-tile__label">生命值 HP</span><span class="derived-tile__value">—</span></div>
          <div class="derived-tile"><span class="derived-tile__label">魔法值 MP</span><span class="derived-tile__value">—</span></div>
          <div class="derived-tile"><span class="derived-tile__label">理智 SAN</span><span class="derived-tile__value">—</span></div>
          <div class="derived-tile"><span class="derived-tile__label">移动力 MOV</span><span class="derived-tile__value">—</span></div>
          <div class="derived-tile"><span class="derived-tile__label">伤害加值 DB</span><span class="derived-tile__value">—</span></div>
          <div class="derived-tile"><span class="derived-tile__label">体格 BUILD</span><span class="derived-tile__value">—</span></div>
        </div>
        <p class="rule-source">
          <strong>规则出处：</strong>《克苏鲁的呼唤》第七版核心规则书 · 第三章「创建调查员」；
          伤害加值与体格查表见角色表。生命值按 (CON+SIZ)/10 向下取整，魔法值为 POW/5 向下取整。
        </p>
      </section>

      <aside class="settings-stack">
        <section class="panel" aria-labelledby="rules-title">
          <div class="panel__head">
            <h2 class="panel__title" id="rules-title">${icon('book')} 规则口径</h2>
            <span class="panel__meta">7E CORE</span>
          </div>
          <ul class="rule-list">
            <li class="rule-item">
              <p class="rule-item__title">八属性与幸运</p>
              <p class="rule-item__text">STR / CON / DEX / APP / POW = 3D6×5<br>SIZ / INT / EDU = (2D6+6)×5<br>LUCK = 3D6×5</p>
            </li>
            <li class="rule-item">
              <p class="rule-item__title">年龄修正</p>
              <p class="rule-item__text">15–19 / 20–39 / 40–49 / 50–59<br>60–69 / 70–79 / 80+ 各档独立调整<br>并叠加 MOV 减值与 EDU 补偿</p>
            </li>
            <li class="rule-item">
              <p class="rule-item__title">技能点预算</p>
              <p class="rule-item__text">职业点 = EDU × 2<br>兴趣点 = INT × 2<br>信用评级必须落在职业区间内</p>
            </li>
            <li class="rule-item">
              <p class="rule-item__title">AI 输出校验</p>
              <p class="rule-item__text">严格 JSON → 数值范围 → 点数总额<br>→ 信用评级 → 失败自动重试</p>
            </li>
          </ul>
        </section>

        <section class="panel" aria-labelledby="builder-flow-title">
          <div class="panel__head">
            <h2 class="panel__title" id="builder-flow-title">${icon('wand')} 建卡流水线</h2>
          </div>
          <ol class="pipeline">
            <li class="pipeline__item">
              <span class="pipeline__num">01</span>
              <div class="pipeline__body">
                <p class="pipeline__title">读取详细人设</p>
                <p class="pipeline__text">职业模板、年龄档与背景关键词共同约束属性倾向。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">02</span>
              <div class="pipeline__body">
                <p class="pipeline__title">生成严格 JSON</p>
                <p class="pipeline__text">属性、技能分配、信用评级一次性输出。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">03</span>
              <div class="pipeline__body">
                <p class="pipeline__title">前端规则校验</p>
                <p class="pipeline__text">不超额、不越界、不伪造职业区间；失败要求模型重试。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">04</span>
              <div class="pipeline__body">
                <p class="pipeline__title">落盘与导出</p>
                <p class="pipeline__text">写入角色卡，同时支持 JSON 与 Markdown 人设卡。</p>
              </div>
            </li>
          </ol>
        </section>
      </aside>
    </div>`;
}

/* =========================================================
 * 模组档案骨架
 * ========================================================= */

function renderModules() {
  return `
    ${pageHead({
      kicker: 'Module Archive',
      title: '模组档案',
      lede: '守秘人的第一原则不是即兴，而是准备。导入原文后，系统会切分章节、场景、线索与 NPC，并在每回合只注入最相关的片段。',
      actions: `<button class="btn btn--primary" type="button" data-action="show-stage" data-stage="5" data-feature="模组导入与结构树">${icon(
        'upload'
      )} 导入模组</button>`,
    })}

    <div class="module-layout">
      <div>
        <section class="drop-zone" aria-labelledby="drop-title">
          <div class="drop-zone__icon">${icon('upload')}</div>
          <h2 class="drop-zone__title" id="drop-title">把模组放进档案柜</h2>
          <p class="drop-zone__text">
            支持直接粘贴文本，或导入 .txt / .md / .json。标题层级会被解析为章节、场景与线索树；
            导入后仍可手动修正切分、标记关键线索和必须触发的事件。
          </p>
          <button class="btn btn--gold" type="button" data-action="show-stage" data-stage="5" data-feature="模组导入器">
            ${icon('file')} 查看导入流程
          </button>
          <div class="format-row" aria-label="支持的文件格式">
            <span class="tag">.txt</span>
            <span class="tag">.md</span>
            <span class="tag">.json</span>
            <span class="tag">直接粘贴</span>
          </div>
        </section>

        <div class="section-head">
          <h2 class="section-head__title">档案柜</h2>
          <span class="panel__meta"><span data-module-count>0</span> MODULES</span>
        </div>
        <div data-module-list>
          ${emptyState({
            title: '档案柜仍是空的',
            text: '导入的模组只会写入本机 IndexedDB。它们不会上传到任何服务器，也不会进入 API 请求之外的地方。',
          })}
        </div>
      </div>

      <aside class="settings-stack">
        <section class="panel" aria-labelledby="pipeline-title">
          <div class="panel__head">
            <h2 class="panel__title" id="pipeline-title">${icon('scroll')} 从文本到桌面</h2>
            <span class="panel__meta">PIPELINE</span>
          </div>
          <ol class="pipeline">
            <li class="pipeline__item">
              <span class="pipeline__num">01</span>
              <div class="pipeline__body">
                <p class="pipeline__title">结构解析</p>
                <p class="pipeline__text">按 Markdown 标题层级与关键词切分章节、场景、线索、NPC。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">02</span>
              <div class="pipeline__body">
                <p class="pipeline__title">人工校正</p>
                <p class="pipeline__text">调整切分边界，标记关键线索与必须触发事件。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">03</span>
              <div class="pipeline__body">
                <p class="pipeline__title">关键词索引</p>
                <p class="pipeline__text">对模组分块建立倒排索引，可按玩家行动检索 2–5 个相关段落。</p>
              </div>
            </li>
            <li class="pipeline__item">
              <span class="pipeline__num">04</span>
              <div class="pipeline__body">
                <p class="pipeline__title">状态与节奏</p>
                <p class="pipeline__text">维护当前章节、已获线索、NPC 态度与未解锁内容，防止提前泄底。</p>
              </div>
            </li>
          </ol>
        </section>

        <section class="panel" aria-labelledby="context-title">
          <div class="panel__head">
            <h2 class="panel__title" id="context-title">${icon('search')} 上下文预算</h2>
          </div>
          <p class="modal-copy">
            长模组不可能整本塞进提示词。系统将采用<strong>关键词倒排 / TF-IDF 检索</strong>，
            结合当前场景与 KP 内部状态，只注入最相关的片段，并把剩余窗口留给最近对话与角色摘要。
          </p>
          <div class="info-strip" style="margin-top: 14px;">
            ${icon('lock')}
            <span>未解锁章节的内容不会进入提示词，也不会被模型“意外看见”。</span>
          </div>
        </section>
      </aside>
    </div>`;
}

async function mountModules() {
  try {
    const modules = await storage.modules.list();
    const count = document.querySelector('[data-module-count]');
    if (count) count.textContent = String(modules.length);
    if (!modules.length) return;
    const list = document.querySelector('[data-module-list]');
    if (!list) return;
    list.innerHTML = `<div class="recent-list">${modules
      .map(
        (module) => `
        <div class="recent-item">
          <span class="recent-item__portrait">${icon('book')}</span>
          <span class="recent-item__body">
            <span class="recent-item__name">${escapeHTML(module.title)}</span>
            <span class="recent-item__meta">${escapeHTML(
              `${module.structure?.chapters?.length || 0} 章 · 更新于 ${formatDate(module.updatedAt)}`
            )}</span>
          </span>
          <span class="recent-item__side">INDEXEDDB</span>
        </div>`
      )
      .join('')}</div>`;
  } catch (error) {
    console.warn('[Cthulhu Table] 读取模组列表失败：', error);
  }
}

/* =========================================================
 * 跑团桌面骨架
 * ========================================================= */

function renderTable() {
  const characters = storage.characters.list();
  const roster = characters.length
    ? characters
        .slice(0, 4)
        .map(
          (character) => `
        <li class="roster-card">
          <span class="roster-card__avatar">${escapeHTML(getInitials(character.name))}</span>
          <span>
            <span class="roster-card__name">${escapeHTML(character.name)}</span>
            <span class="roster-card__role">${escapeHTML(character.occupation || '调查员')}</span>
          </span>
        </li>`
        )
        .join('')
    : `<li class="roster-card"><span class="roster-card__avatar">?</span><span><span class="roster-card__name">尚未入座</span><span class="roster-card__role">先创建调查员</span></span></li>`;

  return `
    ${pageHead({
      kicker: 'The Table',
      title: '跑团桌面',
      lede: '一桌、一盏灯、一位不替你做决定的守秘人。这里将承载对话、检定卡片、线索笔记本与剧情进度。',
      actions: `<a class="btn btn--ghost" href="#/settings">${icon(
        'settings'
      )} 接口设置</a> ${stageBadge(5, '第 5 阶段接入')}`,
    })}

    <div class="table-grid">
      <aside class="table-col table-col--roster">
        <p class="table-col__label">调查员</p>
        <ul class="roster-list">${roster}</ul>
        <div class="table-col__divider"></div>
        <p class="table-col__label">战役状态</p>
        <div class="table-status">
          <div class="table-status__row"><span>当前章节</span><span>未开始</span></div>
          <div class="table-status__row"><span>场景</span><span>—</span></div>
          <div class="table-status__row"><span>时间线</span><span>—</span></div>
          <div class="table-status__row"><span>已获线索</span><span>0</span></div>
        </div>
      </aside>

      <section class="table-col table-col--chat" aria-labelledby="chat-title">
        <header class="chat-head">
          <div>
            <h2 class="chat-head__title" id="chat-title">未命名战役</h2>
            <p class="chat-head__meta">NO MODULE LOADED · 等待守秘人入席</p>
          </div>
          <span class="stage-badge stage-badge--blood"><span class="stage-badge__dot"></span>预览</span>
        </header>
        <div class="chat-empty">
          <img class="chat-empty__sigil" src="assets/sigil.svg" alt="">
          <h3 class="chat-empty__title">雨还没有开始下</h3>
          <p class="chat-empty__text">
            导入一份模组、选好调查员、连接 AI 守秘人之后，这里会出现第一条场景描写。
            现在，先去看看档案柜。
          </p>
          <div class="empty-state__actions">
            <a class="btn btn--gold btn--sm" href="#/modules">${icon('book')} 前往模组档案</a>
            <a class="btn btn--ghost btn--sm" href="#/characters">${icon('users')} 检查名册</a>
          </div>
        </div>
        <div class="composer">
          <textarea class="composer__input" rows="2" placeholder="对话功能将在第四阶段开放……" disabled aria-label="对话输入框（暂不可用）"></textarea>
          <div class="composer__bar">
            <span class="composer__hint">ENTER 发送 · SHIFT+ENTER 换行</span>
            <button class="btn btn--primary composer__send" type="button" disabled>${icon(
              'arrow-right'
            )} 发送</button>
          </div>
        </div>
      </section>

      <aside class="table-col table-col--kp">
        <p class="table-col__label">守秘人状态</p>
        <div class="kp-state">
          <div class="state-line">
            <span class="state-line__label">CURRENT CHAPTER</span>
            <span class="state-line__value state-line__value--empty">尚未开始</span>
          </div>
          <div class="state-line">
            <span class="state-line__label">ACTIVE SCENE</span>
            <span class="state-line__value state-line__value--empty">—</span>
          </div>
          <div class="state-line">
            <span class="state-line__label">DISCOVERED CLUES</span>
            <span class="state-line__value state-line__value--empty">0</span>
          </div>
          <div class="state-line">
            <span class="state-line__label">NPC ATTITUDE</span>
            <span class="state-line__value state-line__value--empty">—</span>
          </div>
          <div class="state-line">
            <span class="state-line__label">TIMELINE</span>
            <span class="state-line__value state-line__value--empty">—</span>
          </div>
        </div>
        <div class="table-col__divider"></div>
        <p class="table-col__label">桌面检查</p>
        <div class="table-status">
          <div class="table-status__row"><span>模组原文</span><span>未载入</span></div>
          <div class="table-status__row"><span>调查员</span><span>${characters.length} 份</span></div>
          <div class="table-status__row"><span>AI 接口</span><span>未配置</span></div>
        </div>
      </aside>
    </div>

    <div class="info-strip" style="margin-top: 18px;">
      ${icon('lock')}
      <span><strong>严格模组模式。</strong> 第五阶段接入后，守秘人只能依据检索到的模组原文推进剧情；未写明的内容仅允许不改变主线的氛围描写，不得凭空创造关键 NPC、地点或结局。</span>
    </div>`;
}

/* =========================================================
 * 设置
 * ========================================================= */

function renderSettings() {
  const settings = storage.settings.get();
  const apiCount = settings.api.profiles.length;

  return `
    ${pageHead({
      kicker: 'Settings & Interface',
      title: '设置与接口',
      lede: '接口与密钥只保存在当前浏览器。请勿在公共设备上保存 API Key；更换设备时，请重新配置而不是导出包含密钥的备份。',
      actions: `<span class="stage-badge"><span class="stage-badge__dot"></span>本地保险库</span>`,
    })}

    <div class="settings-grid">
      <div class="settings-stack">
        <section class="settings-card" aria-labelledby="appearance-title">
          <div class="settings-card__head">
            <div>
              <h2 class="settings-card__title" id="appearance-title">界面与可访问性</h2>
              <p class="settings-card__desc">这些偏好会立即写入 localStorage，并在下次打开时恢复。</p>
            </div>
            ${icon('eye')}
          </div>
          <div class="setting-row">
            <div>
              <p class="setting-row__title">减少动效</p>
              <p class="setting-row__desc">关闭启动印记旋转、页面淡入与弹窗位移动画，适合晕动敏感用户。</p>
            </div>
            <button class="switch" type="button" role="switch" aria-checked="${
              settings.app.reduceMotion
            }" aria-label="减少动效" data-action="toggle-reduce-motion"></button>
          </div>
          <div class="setting-row">
            <div>
              <p class="setting-row__title">界面语言</p>
              <p class="setting-row__desc">当前版本仅提供简体中文。术语遵循 CoC 7e 中文社区常用译名。</p>
            </div>
            <span class="tag">简体中文</span>
          </div>
        </section>

        <section class="settings-card" aria-labelledby="storage-title">
          <div class="settings-card__head">
            <div>
              <h2 class="settings-card__title" id="storage-title">本地存储</h2>
              <p class="settings-card__desc">角色与设置存 localStorage；模组、聊天与存档存 IndexedDB。</p>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-action="run-storage-check">
              ${icon('refresh')} 运行自检
            </button>
          </div>
          <ul class="status-list">
            <li class="status-row">
              <span class="status-row__dot" data-storage-local-dot></span>
              <span class="status-row__label">localStorage</span>
              <span class="status-row__value" data-storage-local-value>检测中…</span>
            </li>
            <li class="status-row">
              <span class="status-row__dot" data-storage-idb-dot></span>
              <span class="status-row__label">IndexedDB</span>
              <span class="status-row__value" data-storage-idb-value>检测中…</span>
            </li>
            <li class="status-row">
              <span class="status-row__dot status-row__dot--ok"></span>
              <span class="status-row__label">档案规模</span>
              <span class="status-row__value" data-storage-counts>读取中…</span>
            </li>
            <li class="status-row">
              <span class="status-row__dot"></span>
              <span class="status-row__label">浏览器配额</span>
              <span class="status-row__value" data-storage-quota>读取中…</span>
            </li>
          </ul>
          <div class="storage-meter" aria-hidden="true"><span class="storage-meter__bar" data-storage-meter></span></div>
          <div class="storage-meter__caption">
            <span data-storage-usage>已用 —</span>
            <span data-storage-percent>—</span>
          </div>
          <div class="info-strip" style="margin-top: 16px;">
            ${icon('shield')}
            <span>隐私模式或浏览器清理策略可能导致数据丢失。<strong>请定期导出备份。</strong></span>
          </div>
          <div class="modal-actions" style="margin-top: 16px;">
            <button class="btn btn--gold" type="button" data-action="export-backup">
              ${icon('download')} 导出完整备份
            </button>
            <button class="btn btn--ghost" type="button" data-action="show-stage" data-stage="6" data-feature="备份导入与读档">
              导入备份
            </button>
          </div>
        </section>
      </div>

      <div class="settings-stack">
        <section class="settings-card" aria-labelledby="api-title">
          <div class="settings-card__head">
            <div>
              <h2 class="settings-card__title" id="api-title">AI 接口</h2>
              <p class="settings-card__desc">兼容 OpenAI Chat Completions，多套配置可命名、切换与测试。</p>
            </div>
            ${stageBadge(3)}
          </div>
          <div class="setting-row">
            <div>
              <p class="setting-row__title">已保存接口</p>
              <p class="setting-row__desc">baseURL、Model、温度、Max Tokens、Top P、流式与联网开关。</p>
            </div>
            <span class="tag" data-api-profile-count>${apiCount} 套</span>
          </div>
          <div class="privacy-note">
            <p class="privacy-note__title">${icon('lock')} API Key 只存本地</p>
            <p class="privacy-note__text">
              密钥写入 localStorage，并通过前端 fetch 直连你填写的接口地址。
              本站没有后端，也不会上传密钥。公共电脑使用后请清除浏览器数据。
            </p>
          </div>
          <div class="modal-actions" style="margin-top: 16px;">
            <button class="btn btn--primary" type="button" data-action="show-stage" data-stage="3" data-feature="多接口管理、流式对话与 AI 车卡">
              ${icon('key')} 查看接口规划
            </button>
          </div>
        </section>

        <section class="settings-card" aria-labelledby="about-title">
          <div class="settings-card__head">
            <div>
              <h2 class="settings-card__title" id="about-title">关于 Cthulhu Table</h2>
              <p class="settings-card__desc">纯前端、零构建、本地优先的同人跑团桌面。</p>
            </div>
            <img src="assets/sigil.svg" alt="" width="34" height="34" style="opacity:.65">
          </div>
          <ul class="status-list">
            <li class="status-row"><span class="status-row__label">版本</span><span class="status-row__value">v0.1.0 · 第一阶段</span></li>
            <li class="status-row"><span class="status-row__label">规则系统</span><span class="status-row__value">CoC 7th Edition</span></li>
            <li class="status-row"><span class="status-row__label">技术栈</span><span class="status-row__value">ES Modules · CSS · IndexedDB</span></li>
            <li class="status-row"><span class="status-row__label">部署</span><span class="status-row__value">GitHub Pages</span></li>
          </ul>
          <p class="rule-source">
            本工具是非官方同人作品，与 Chaosium Inc. 无隶属关系。模组文本与规则书的权利归各自权利人所有；
            请仅导入你拥有使用权的文本。
          </p>
        </section>
      </div>
    </div>`;
}

async function mountSettings() {
  await refreshStorageView();
  const count = storage.settings.get().api.profiles.length;
  setText('[data-api-profile-count]', `${count} 套`);
}

async function refreshStorageView() {
  if (!document.querySelector('[data-storage-local-value]')) return;
  try {
    const stats = await storage.diagnostics.stats();
    const localDot = document.querySelector('[data-storage-local-dot]');
    const idbDot = document.querySelector('[data-storage-idb-dot]');
    localDot?.classList.toggle('status-row__dot--ok', stats.localAvailable);
    localDot?.classList.toggle('status-row__dot--bad', !stats.localAvailable);
    idbDot?.classList.toggle('status-row__dot--ok', stats.indexedDbAvailable);
    idbDot?.classList.toggle('status-row__dot--bad', !stats.indexedDbAvailable);
    setText('[data-storage-local-value]', stats.localAvailable ? '可用' : '不可用 · 内存降级');
    setText('[data-storage-idb-value]', stats.indexedDbAvailable ? '可用' : '不可用');
    setText(
      '[data-storage-counts]',
      `${stats.characters} 角色 · ${stats.modules} 模组 · ${stats.chats} 对话 · ${stats.saves} 存档`
    );
    setText(
      '[data-storage-quota]',
      stats.quota ? `${formatBytes(stats.usage)} / ${formatBytes(stats.quota)}` : '浏览器未提供'
    );
    setText('[data-storage-usage]', `已用 ${formatBytes(stats.usage)}`);
    setText(
      '[data-storage-percent]',
      stats.usagePercent ? `${stats.usagePercent.toFixed(1)}%` : '—'
    );
    const meter = document.querySelector('[data-storage-meter]');
    if (meter) meter.style.width = `${Math.max(0, Math.min(100, stats.usagePercent))}%`;
  } catch (error) {
    console.warn('[Cthulhu Table] 存储状态读取失败：', error);
    setText('[data-storage-local-value]', '读取失败');
    setText('[data-storage-idb-value]', '读取失败');
  }
}

/* =========================================================
 * 未找到页面
 * ========================================================= */

function renderNotFound() {
  return `
    <header class="page-head">
      <div class="page-head__main">
        <p class="page-kicker">Lost in the Archives</p>
        <h1 class="page-title">这条走廊不在档案里</h1>
        <p class="page-lede">你推开了一扇不该存在的门。回到有灯的地方，或者从总览重新开始调查。</p>
      </div>
      <div class="page-head__actions">
        <a class="btn btn--primary" href="#/home">${icon('home')} 返回总览</a>
      </div>
    </header>
    ${emptyState({
      title: '404 · 路径未收录',
      text: '页面地址可能已经改变。所有进度仍安全保存在本地，不会因为一次迷路而丢失。',
      actions: `<a class="btn btn--ghost" href="#/characters">前往调查员名册</a>`,
    })}`;
}

/* =========================================================
 * 路由
 * ========================================================= */

const ROUTES = {
  '/home': { title: '战役总览', render: renderHome, mount: mountHome },
  '/characters': { title: '调查员名册', render: renderCharacters },
  '/builder': { title: '车卡工坊', render: renderBuilder },
  '/modules': { title: '模组档案', render: renderModules, mount: mountModules },
  '/table': { title: '跑团桌面', render: renderTable },
  '/settings': { title: '设置与接口', render: renderSettings, mount: mountSettings },
};

let renderSequence = 0;

function readRoutePath() {
  const hash = window.location.hash.replace(/^#/, '');
  const path = (hash || '/home').split('?')[0];
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function updateActiveNav(path) {
  document.querySelectorAll('.nav__link[data-route]').forEach((link) => {
    const active = link.dataset.route === path;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateNavCounts() {
  const count = storage.characters.count();
  document.querySelectorAll('[data-nav-count="characters"]').forEach((element) => {
    element.textContent = String(count);
  });
}

function syncNavAccessibility() {
  if (!sidebar) return;
  const desktop = window.matchMedia('(min-width: 1021px)').matches;
  const isOpen = document.body.classList.contains('nav-open');
  // 移动端侧栏关闭时不可被键盘/读屏访问；桌面端始终可访问。
  sidebar.toggleAttribute('inert', !desktop && !isOpen);
}

function closeNav({ restoreFocus = false } = {}) {
  if (!document.body.classList.contains('nav-open')) {
    syncNavAccessibility();
    return;
  }
  document.body.classList.remove('nav-open');
  menuButton?.setAttribute('aria-expanded', 'false');
  syncNavAccessibility();
  if (restoreFocus) menuButton?.focus({ preventScroll: true });
}

function openNav() {
  document.body.classList.add('nav-open');
  menuButton?.setAttribute('aria-expanded', 'true');
  syncNavAccessibility();
  sidebar?.querySelector('[data-action="close-nav"]')?.focus({ preventScroll: true });
}

async function renderRoute({ animate = true, scroll = true } = {}) {
  const path = readRoutePath();
  const route = ROUTES[path] || {
    title: '路径未收录',
    render: renderNotFound,
  };

  currentPath = path;
  const sequence = ++renderSequence;

  updateActiveNav(path);
  topbarTitle.textContent = route.title;
  document.title = `${route.title} · Cthulhu Table`;
  view.innerHTML = route.render();

  if (animate) {
    view.classList.remove('is-entering');
    void view.offsetWidth;
    view.classList.add('is-entering');
  }

  if (scroll) {
    const reduceMotion =
      storage.settings.get().app.reduceMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  closeNav();
  updateNavCounts();

  if (typeof route.mount === 'function') {
    try {
      await route.mount({ path, sequence });
    } catch (error) {
      console.error('[Cthulhu Table] 页面挂载失败：', error);
      if (sequence === renderSequence) {
        toast('页面数据加载不完整，请刷新后重试。', { type: 'error' });
      }
    }
  }
}

function navigateHomeFallback() {
  if (!window.location.hash) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', `${base}#/home`);
  }
}

/* =========================================================
 * 交互动作
 * ========================================================= */

const STAGE_CONTENT = {
  2: {
    title: '角色系统与车卡规则',
    items: [
      '详尽 PL / NPC 人设表单，覆盖全部背景字段',
      'CoC 7e 严格车卡：属性、年龄修正、MOV、DB / Build、技能点与信用评级',
      '内置侦探、记者、医生、教授、神父、古董商、警察、黑帮、艺术家等职业模板',
      '随机骰点、手动分配、JSON / Markdown 导入导出与前端规则校验',
    ],
  },
  3: {
    title: 'AI 接口与自动车卡',
    items: [
      '多套 OpenAI 兼容配置，可命名、切换、测试连通性',
      'SSE 流式输出、自定义请求头 / 请求体与联网开关',
      '基于详细人设的严格 JSON 车卡输出，前端校验失败自动重试',
      '请求耗时、Token 用量与错误日志',
    ],
  },
  4: {
    title: '骰子、检定与对话',
    items: [
      '自研骰子表达式引擎与奖励 / 惩罚骰',
      'CoC 成功等级、对抗检定、SAN 损失与疯狂',
      '聊天卡片、暗骰、伤害与濒死状态',
      'Enter 发送、Shift+Enter 换行',
    ],
  },
  5: {
    title: '模组与 AI 守秘人',
    items: [
      '导入 .txt / .md / .json，切分章节、场景、线索、NPC',
      '关键词倒排 / TF-IDF 检索与上下文预算',
      'KP 内部状态 JSON、剧情进度与线索笔记本',
      '严格模组约束的守秘人提示词与信息释放节奏',
    ],
  },
  6: {
    title: '战役归档与发布',
    items: [
      '整战役存档导出 / 导入与聊天记录分组',
      'API 日志面板、移动端细节与快捷键覆盖',
      '首屏引导、示例战役与空状态完善',
      'GitHub Pages 部署检查与兼容性回归',
    ],
  },
};

function showStageRoadmap(feature, stage) {
  const content = STAGE_CONTENT[stage] || {
    title: '后续阶段',
    items: ['该能力会在后续开发阶段接入。'],
  };
  openModal({
    eyebrow: `开发路线图 · 第 ${escapeHTML(stage)} 阶段`,
    title: `${feature}：${content.title}`,
    body: `
      <p class="modal-copy">
        当前版本是<strong>第一阶段可运行骨架</strong>，重点是页面结构、视觉系统与本地数据层。
        这个入口已经预留，但不会用静态假数据冒充已完成功能。
      </p>
      <ul class="modal-list">
        ${content.items.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}
      </ul>
      <div class="info-strip" style="margin-top: 18px;">
        ${icon('shield')}
        <span>第一阶段的数据层已经准备好角色、模组、聊天与存档的存储接口，后续阶段会直接接入。</span>
      </div>`,
    footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>知道了</button></div>`,
  });
}

async function loadSampleCharacters() {
  const samples = createSampleCharacters();
  let added = 0;
  for (const sample of samples) {
    if (!storage.characters.get(sample.id)) {
      storage.characters.save(sample);
      added += 1;
    }
  }
  updateNavCounts();

  if (added > 0) {
    toast(`已载入 ${added} 位示例调查员。可随时查看档案或删除。`, {
      type: 'success',
      title: '名册已更新',
    });
  } else {
    toast('示例调查员已经在新名册中。', { type: 'info' });
  }

  if (['/home', '/characters', '/table', '/settings'].includes(currentPath)) {
    await renderRoute({ animate: false, scroll: false });
  }
}

async function removeCharacter(id) {
  const character = storage.characters.get(id);
  if (!character) {
    toast('角色不存在或已被删除。', { type: 'error' });
    return;
  }
  const confirmed = await confirmDialog({
    eyebrow: '删除角色档案',
    title: `真的要删除 ${character.name} 吗？`,
    message: '这会从本地名册中移除整份角色卡，包括人设、属性、技能与笔记。该操作无法撤销。建议先导出 JSON。',
    confirmLabel: '删除档案',
    danger: true,
  });
  if (!confirmed) return;

  storage.characters.remove(id);
  updateNavCounts();
  toast(`${character.name} 已从名册移除。`, { type: 'success' });
  if (['/home', '/characters', '/table'].includes(currentPath)) {
    await renderRoute({ animate: false, scroll: false });
  }
}

async function exportCharacter(id) {
  const character = storage.characters.get(id);
  if (!character) {
    toast('找不到要导出的角色。', { type: 'error' });
    return;
  }
  const json = storage.characters.exportJSON(id);
  downloadFile(`${sanitizeFilename(character.name, 'investigator')}-调查员.json`, json);
  toast('角色 JSON 已导出。', { type: 'success' });
}

async function exportBackup() {
  const backup = await storage.backup.export();
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(
    `cthulhu-table-backup-${date}.json`,
    JSON.stringify(backup, null, 2),
    'application/json;charset=utf-8'
  );
  toast('完整备份已导出。请妥善保管，其中包含 API 配置。', {
    type: 'success',
    title: '备份完成',
    duration: 5200,
  });
}

function applyReduceMotion(value) {
  document.documentElement.dataset.reduceMotion = value ? 'true' : 'false';
}

async function toggleReduceMotion(element) {
  const settings = storage.settings.get();
  const next = !settings.app.reduceMotion;
  storage.settings.set('app.reduceMotion', next);
  applyReduceMotion(next);
  element.setAttribute('aria-checked', String(next));
  toast(next ? '已减少界面动效。' : '已恢复界面动效。', { type: 'info', duration: 2200 });
}

async function runStorageCheck(element) {
  const original = element.innerHTML;
  element.disabled = true;
  element.textContent = '自检中…';
  try {
    const result = await storage.diagnostics.selfTest();
    await refreshStorageView();
    if (result.ok) {
      toast(`本地存储工作正常，耗时 ${result.latencyMs} ms。`, {
        type: 'success',
        title: '存储自检通过',
      });
    } else {
      toast(result.errors.join(' ') || '自检未完全通过。', {
        type: 'error',
        title: '存储自检失败',
        duration: 7000,
      });
    }
  } finally {
    element.disabled = false;
    element.innerHTML = original;
  }
}

async function handleAction(action, element) {
  switch (action) {
    case 'open-nav':
      openNav();
      break;
    case 'close-nav':
      closeNav({ restoreFocus: true });
      break;
    case 'load-sample':
      await loadSampleCharacters();
      break;
    case 'view-character':
      openCharacterSheet(element.dataset.characterId);
      break;
    case 'delete-character':
      await removeCharacter(element.dataset.characterId);
      break;
    case 'export-character':
      await exportCharacter(element.dataset.characterId);
      break;
    case 'toggle-reduce-motion':
      await toggleReduceMotion(element);
      break;
    case 'run-storage-check':
      await runStorageCheck(element);
      break;
    case 'export-backup':
      await exportBackup();
      break;
    case 'show-stage':
      showStageRoadmap(element.dataset.feature || '此功能', Number(element.dataset.stage) || 6);
      break;
    default:
      console.warn(`[Cthulhu Table] 未处理的动作：${action}`);
  }
}

/* =========================================================
 * 全局事件与启动
 * ========================================================= */

function bindGlobalEvents() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target?.closest('[data-action]');
    if (!trigger || trigger.disabled) return;
    if (trigger.tagName === 'A') event.preventDefault();
    Promise.resolve(handleAction(trigger.dataset.action, trigger)).catch((error) => {
      console.error('[Cthulhu Table] 交互失败：', error);
      toast(error?.message || '操作失败，请稍后重试。', { type: 'error', duration: 6000 });
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeNav({ restoreFocus: true });
    }
  });

  window.addEventListener('hashchange', () => {
    renderRoute().catch((error) => {
      console.error('[Cthulhu Table] 路由渲染失败：', error);
      toast('页面加载失败，请刷新重试。', { type: 'error' });
    });
  });

  window.addEventListener('cthulhu:characters-changed', updateNavCounts);

  const desktopQuery = window.matchMedia('(min-width: 1021px)');
  desktopQuery.addEventListener?.('change', (event) => {
    if (event.matches) closeNav({ restoreFocus: false });
    syncNavAccessibility();
  });
}

function finishBoot() {
  const elapsed = performance.now() - bootStartedAt;
  const delay = Math.max(0, 320 - elapsed);
  window.setTimeout(() => {
    document.body.classList.remove('is-booting');
    bootScreen?.classList.add('is-hidden');
    window.setTimeout(() => bootScreen?.remove(), 700);
  }, delay);
}

function showFatalError(error) {
  console.error('[Cthulhu Table] 初始化失败：', error);
  if (bootNote) bootNote.textContent = '初始化失败。你的本地数据没有被发送到任何地方。';
  if (bootHint) {
    bootHint.classList.add('is-visible');
    bootHint.innerHTML = `<strong>初始化失败</strong><br>${escapeHTML(
      error?.message || '未知错误'
    )}<br>请打开开发者工具查看控制台，或刷新页面重试。`;
  }
}

async function boot() {
  const settings = storage.settings.get();
  applyReduceMotion(settings.app.reduceMotion);
  bindGlobalEvents();
  syncNavAccessibility();
  updateNavCounts();
  navigateHomeFallback();

  // 先让首屏渲染完成，再收起启动页；页面内的异步数据（IndexedDB 统计等）
  // 不应阻塞启动页，否则存储诊断一旦变慢，用户会一直看到“正在唤醒”。
  const routeReady = renderRoute({ animate: false, scroll: false });
  finishBoot();
  await routeReady;

  if (!storage.diagnostics.isLocalStorageAvailable()) {
    window.setTimeout(() => {
      toast('localStorage 不可用，本次角色与设置只会保留在内存中。关闭页面后将丢失。', {
        type: 'error',
        title: '存储警告',
        duration: 9000,
      });
    }, 500);
  }
}

boot().catch(showFatalError);
