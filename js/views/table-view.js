/**
 * table-view.js — 跑团桌面：聊天、骰子、KP 流式叙事
 */

import { storage } from '../storage.js';
import { api } from '../api.js';
import {
  cocCheck,
  formatCheckResult,
  opposedCheck,
  rollD100,
  rollExpression,
  sanityCheck,
  spendLuck,
  SUCCESS_LABEL,
  DIFFICULTY_LABEL,
} from '../dice.js';
import { buildKpContext, computeProgress, parseKpStateBlock, mergeKpState } from '../kp.js';
import { findScene } from '../module.js';
import { generateActorAction } from '../actor.js';
import {
  summarizeCampaignMemories,
  attachMemoriesToCharacters,
  memoryToWorldbookEntry,
} from '../memory.js';
import {
  escapeHTML,
  icon,
  getInitials,
  formatRelative,
  downloadFile,
  sanitizeFilename,
  toast,
  openModal,
  closeModal,
  confirmDialog,
} from '../ui.js';

let campaign = null;
let moduleData = null;
let chat = null;
let characters = [];
let selectedCharacterId = '';
let sending = false;
let actorBusy = false;
let abortController = null;
let currentProfile = null;
let worldbookEntries = [];

const DIFFICULTY_ALIASES = {
  regular: 'regular',
  normal: 'regular',
  常规: 'regular',
  普通: 'regular',
  hard: 'hard',
  困难: 'hard',
  extreme: 'extreme',
  极难: 'extreme',
};

function createMessageId() {
  if (globalThis.crypto?.randomUUID) return `msg_${crypto.randomUUID()}`;
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createChatId(campaignId) {
  return `${campaignId}_main`;
}

function messageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function selectedCharacter() {
  return characters.find((character) => character.id === selectedCharacterId) || characters[0] || null;
}

function skillOptions(character) {
  if (!character) return '<option value="">无可用调查员</option>';
  return [...(character.skills || [])]
    .filter((skill) => skill.total > 0)
    .sort((a, b) => b.total - a.total)
    .map(
      (skill) =>
        `<option value="${escapeHTML(skill.name)}" ${skill.name === '侦查' ? 'selected' : ''}>${escapeHTML(
          skill.name
        )} ${skill.total}</option>`
    )
    .join('');
}

function statusLabel(status) {
  return (
    { setup: '准备中', active: '进行中', paused: '暂停', completed: '已完结' }[status] || '进行中'
  );
}

/* =========================================================
 * 页面渲染
 * ========================================================= */

async function loadTableState() {
  campaign = storage.campaigns.getActive();
  if (!campaign) return;
  moduleData = campaign.moduleId ? await storage.modules.get(campaign.moduleId) : null;
  characters = campaign.playerCharacterIds
    .map((id) => storage.characters.get(id))
    .filter(Boolean);
  if (!characters.length) characters = storage.characters.list({ kind: 'pc' });
  if (!characters.some((character) => character.id === selectedCharacterId)) {
    selectedCharacterId = characters[0]?.id || '';
  }
  const chatId = campaign.chatIds?.[0] || createChatId(campaign.id);
  chat = await storage.chats.get(chatId);
  if (!chat) {
    chat = {
      id: chatId,
      campaignId: campaign.id,
      title: `${campaign.title} · 主记录`,
      sceneId: campaign.kpState?.currentSceneId || '',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  campaign.kpState = campaign.kpState || {};
  currentProfile = storage.settings.getActiveApiProfile();
  worldbookEntries = await storage.worldbook
    .forContext(campaign.id, characters.map((character) => character.id))
    .catch(() => []);
}

function renderSetup() {
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">The Table</p>
      <h1 class="page-title">跑团桌面</h1>
      <p class="page-lede">还没有进行中的战役。从模组档案选择一份模组、带上调查员，再让守秘人入席。</p>
    </div>
    <div class="page-head__actions">
      <a class="btn btn--primary" href="#/modules">${icon('book')} 选择模组</a>
      <a class="btn btn--ghost" href="#/characters">${icon('users')} 查看名册</a>
    </div>
  </header>
  <div class="empty-state">
    <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
    <h2 class="empty-state__title">雨还没有开始下</h2>
    <p class="empty-state__text">导入模组、准备好调查员，再从档案柜点击「开始战役」。所有对话与骰点都会留在本地。</p>
    <div class="empty-state__actions">
      <a class="btn btn--gold" href="#/modules">${icon('book')} 前往模组档案</a>
      <a class="btn btn--ghost" href="#/settings">${icon('key')} 配置 AI 接口</a>
    </div>
  </div>`;
}

function messageMarkup(message) {
  if (message.role === 'dice') {
    const diceMeta = message.meta?.dice || {};
    const hidden = Boolean(message.meta?.hidden) && !message.meta?.revealed;
    if (hidden) {
      return `<article class="chat-message chat-message--dice is-hidden" data-message-id="${escapeHTML(
        message.id
      )}">
        <div class="dice-card__top"><span class="dice-card__kicker">${icon('eye')} 暗骰</span><span class="tag">仅 KP 可见</span></div>
        <p class="dice-card__summary">结果已记录，但不会展示给玩家。</p>
        <button class="btn btn--ghost btn--sm" type="button" data-action="reveal-dice" data-message-id="${escapeHTML(
          message.id
        )}">揭示结果</button>
      </article>`;
    }
    return `<article class="chat-message chat-message--dice" data-message-id="${escapeHTML(
      message.id
    )}">
      <div class="dice-card__top">
        <span class="dice-card__kicker">${icon('dice')} ${escapeHTML(
          diceMeta.kind === 'check' ? '技能检定' : diceMeta.kind === 'san' ? 'SAN 检定' : '骰子'
        )}</span>
        ${
          diceMeta.check?.levelLabel
            ? `<span class="check-badge check-badge--${escapeHTML(diceMeta.check.level)}">${escapeHTML(
                diceMeta.check.levelLabel
              )}</span>`
            : ''
        }
        ${message.meta?.hidden ? '<span class="tag">暗骰</span>' : ''}
      </div>
      <p class="dice-card__formula">${escapeHTML(message.content)}</p>
      ${
        diceMeta.check
          ? `<div class="dice-card__detail">
              <span>掷骰 <strong>${escapeHTML(diceMeta.check.roll)}</strong></span>
              <span>目标 <strong>${escapeHTML(diceMeta.check.targetValue)}</strong></span>
              <span>等级 <strong>${escapeHTML(diceMeta.check.levelLabel)}</strong></span>
              <span>${diceMeta.check.passed ? '通过' : '未通过'}</span>
            </div>`
          : ''
      }
      ${
        diceMeta.san
          ? `<div class="dice-card__detail">
              <span>SAN 损失 <strong>${escapeHTML(diceMeta.san.loss)}</strong></span>
              ${diceMeta.san.temporaryInsanity ? '<span class="tag tag--npc">临时疯狂判定</span>' : ''}
            </div>`
          : ''
      }
      <div class="dice-card__actions">
        <button class="btn btn--gold btn--sm" type="button" data-action="dice-to-kp" data-message-id="${escapeHTML(
          message.id
        )}">${icon('arrow-right')} 把结果交给 KP</button>
        <span class="faint">${escapeHTML(messageTime(message.createdAt))}</span>
      </div>
    </article>`;
  }

  const speaker =
    message.role === 'assistant'
      ? '守秘人'
      : message.role === 'system'
        ? '桌面'
        : message.speaker || selectedCharacter()?.name || '调查员';
  return `<article class="chat-message chat-message--${escapeHTML(message.role)}" data-message-id="${escapeHTML(
    message.id
  )}">
    <div class="chat-message__head">
      <span class="chat-message__speaker">${escapeHTML(speaker)}${
        message.meta?.aiActor ? ' · AI 代演' : ''
      }</span>
      <span class="chat-message__time">${escapeHTML(messageTime(message.createdAt))}</span>
    </div>
    <div class="chat-message__text" data-message-text>${escapeHTML(message.content)}</div>
  </article>`;
}

function renderKpSidebar() {
  if (!campaign || !moduleData) return '';
  const state = campaign.kpState || {};
  const progress = computeProgress(moduleData, state);
  const currentScene = findScene(moduleData, state.currentSceneId)?.scene;
  const discovered = new Set(state.discoveredClueIds || []);
  const clueList = (moduleData.clues || []).map((clue) => ({
    ...clue,
    discovered: discovered.has(clue.id),
  }));
  const npcNames = new Map((moduleData.npcs || []).map((npc) => [npc.id, npc.name]));
  const timeline = [...(state.timeline || [])].slice(-3).reverse();

  return `<div class="kp-panel__inner" id="kp-state-panel">
    <div class="kp-progress">
      <div class="kp-progress__row"><span>场景探索</span><strong>${Math.round(progress.scenePercent)}%</strong></div>
      <div class="kp-progress__bar"><span style="width:${progress.scenePercent}%"></span></div>
      <div class="kp-progress__row"><span>线索收集</span><strong>${Math.round(progress.cluePercent)}%</strong></div>
      <div class="kp-progress__bar"><span style="width:${progress.cluePercent}%"></span></div>
    </div>
    <div class="kp-block">
      <p class="kp-block__label">当前章节</p>
      <p class="kp-block__title">${escapeHTML(progress.chapterTitle)}</p>
      <p class="kp-block__sub">${escapeHTML(currentScene?.title || progress.sceneTitle)}</p>
    </div>
    <div class="kp-block">
      <p class="kp-block__label">已获线索 <span>${discovered.size} / ${clueList.length}</span></p>
      ${
        clueList.some((clue) => clue.discovered)
          ? `<ul class="clue-list">${clueList
              .filter((clue) => clue.discovered)
              .map(
                (clue) =>
                  `<li><span class="clue-dot"></span><span>${escapeHTML(clue.title)}</span>${
                    clue.isKey ? '<span class="tag tag--blood">关键</span>' : ''
                  }</li>`
              )
              .join('')}</ul>`
          : '<p class="kp-empty">尚未发现线索。</p>'
      }
    </div>
    <div class="kp-block">
      <p class="kp-block__label">NPC 态度</p>
      ${
        Object.keys(state.npcAttitudes || {}).length
          ? `<ul class="npc-attitude-list">${Object.entries(state.npcAttitudes)
              .slice(0, 5)
              .map(
                ([id, value]) =>
                  `<li><span>${escapeHTML(npcNames.get(id) || id)}</span><span class="tag">${escapeHTML(
                    value.attitude || '中立'
                  )}</span></li>`
              )
              .join('')}</ul>`
          : '<p class="kp-empty">暂无 NPC 记录。</p>'
      }
    </div>
    <div class="kp-block">
      <p class="kp-block__label">时间线</p>
      ${
        timeline.length
          ? `<ul class="timeline-list">${timeline
              .map(
                (entry) =>
                  `<li><span class="timeline-time">${escapeHTML(entry.inGameTime || '—')}</span><span>${escapeHTML(
                    entry.summary
                  )}</span></li>`
              )
              .join('')}</ul>`
          : '<p class="kp-empty">时间尚未推进。</p>'
      }
    </div>
    <button class="btn btn--ghost btn--sm" type="button" data-action="view-kp-state">${icon(
      'eye'
    )} 查看内部状态 JSON</button>
  </div>`;
}

function renderTable() {
  if (!campaign) return renderSetup();
  if (!moduleData) {
    return `<header class="page-head"><div class="page-head__main"><p class="page-kicker">The Table</p><h1 class="page-title">模组缺失</h1><p class="page-lede">当前战役关联的模组已不存在，无法继续。请从模组档案重新开始。</p></div><div class="page-head__actions"><a class="btn btn--primary" href="#/modules">${icon(
      'book'
    )} 模组档案</a></div></header>`;
  }

  const state = campaign.kpState || {};
  const currentScene = findScene(moduleData, state.currentSceneId)?.scene;
  const messages = chat?.messages || [];
  const profileLabel = currentProfile
    ? `${currentProfile.name} · ${currentProfile.model || '未填写模型'}`
    : '未配置接口';
  const roster = characters.length
    ? characters
        .map(
          (character) => `<button class="roster-card ${character.id === selectedCharacterId ? 'is-active' : ''}" type="button" data-action="select-character" data-character-id="${escapeHTML(
            character.id
          )}">
            <span class="roster-card__avatar">${escapeHTML(getInitials(character.name))}</span>
            <span class="roster-card__body">
              <span class="roster-card__name">${escapeHTML(character.name)}</span>
              <span class="roster-card__role">${escapeHTML(character.occupation || '调查员')} · HP ${
                character.derived?.hp?.current ?? '?'
              } / ${character.derived?.hp?.max ?? '?'}</span>
            </span>
            <span class="roster-card__state">${character.derived?.san?.current ?? '?'} SAN</span>
          </button>`
        )
        .join('')
    : '<p class="kp-empty">没有调查员。</p>';

  const sceneIntro = currentScene
    ? `<div class="chat-scene">
        <p class="chat-scene__kicker">CURRENT SCENE</p>
        <h3 class="chat-scene__title">${escapeHTML(currentScene.title)}</h3>
        <p class="chat-scene__text">${escapeHTML(
          currentScene.summary || currentScene.readAloud || String(currentScene.content || '').slice(0, 500)
        )}</p>
      </div>`
    : '';

  return `<header class="page-head table-head">
    <div class="page-head__main">
      <p class="page-kicker">The Table · ${escapeHTML(statusLabel(campaign.status))}</p>
      <h1 class="page-title">${escapeHTML(campaign.title)}</h1>
      <p class="page-lede">${escapeHTML(moduleData.title)} · ${escapeHTML(
        currentScene?.title || '等待场景'
      )} · ${escapeHTML(profileLabel)}</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" type="button" data-action="save-game">${icon(
        'download'
      )} 存档</button>
      <button class="btn btn--ghost" type="button" data-action="show-saves">${icon(
        'scroll'
      )} 读档</button>
      <button class="btn btn--ghost" type="button" data-action="manage-chat">${icon(
        'file'
      )} 记录</button>
      <button class="btn btn--ghost" type="button" data-action="export-campaign">${icon(
        'upload'
      )} 导出</button>
      <a class="icon-btn" href="#/worldbook" title="世界书">${icon('book')}</a>
      <button class="btn btn--gold btn--sm" type="button" data-action="finalize-campaign">${icon(
        'scroll'
      )} 完结战役</button>
      <a class="icon-btn" href="#/settings" title="接口设置">${icon('settings')}</a>
    </div>
  </header>

  ${
    !currentProfile
      ? `<div class="info-strip info-strip--blood" style="margin-bottom:16px;">${icon(
          'key'
        )}<span><strong>尚未配置 AI 接口。</strong> 骰子与聊天记录仍可使用，但守秘人不会回应。请前往 <a href="#/settings">设置与接口</a> 添加配置。</span></div>`
      : ''
  }

  <div class="play-layout">
    <aside class="play-roster">
      <div class="panel__head"><h2 class="panel__title">${icon('users')} 调查员</h2></div>
      <div class="roster-list">${roster}</div>
      <div class="play-roster__meta">
        <p class="panel__meta">${characters.length} PLAYERS</p>
        <p class="panel__meta">${(moduleData.clues || []).length} CLUES</p>
      </div>
    </aside>

    <section class="play-chat">
      <div class="chat-head chat-head--play">
        <div>
          <h2 class="chat-head__title">${escapeHTML(currentScene?.title || '未开始')}</h2>
          <p class="chat-head__meta">${escapeHTML(state.currentChapterId || 'NO CHAPTER')} · ${escapeHTML(
            currentProfile?.model || 'NO MODEL'
          )}</p>
        </div>
        <div class="chat-head__actions">
          ${sending ? `<button class="btn btn--danger btn--sm" type="button" data-action="abort-generation">${icon('x')} 停止</button>` : ''}
          <span class="stage-badge stage-badge--blood"><span class="stage-badge__dot"></span>STRICT MODULE</span>
        </div>
      </div>

      <div class="chat-messages" id="chat-messages" aria-live="polite">
        ${sceneIntro}
        ${messages.map(messageMarkup).join('')}
      </div>

      <div class="chat-composer">
        <div class="dice-tools">
          <div class="dice-tools__row">
            <input class="form-input form-input--mono" id="dice-expression" value="1d100" aria-label="骰子表达式">
            <select class="form-input" id="dice-count" aria-label="奖励或惩罚骰数量">
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
            <select class="form-input" id="dice-mode" aria-label="奖励或惩罚">
              <option value="none">普通</option>
              <option value="bonus">奖励</option>
              <option value="penalty">惩罚</option>
            </select>
            <label class="check-label"><input type="checkbox" id="dice-hidden"> 暗骰</label>
            <button class="btn btn--gold btn--sm" type="button" data-action="roll-dice">${icon(
              'dice'
            )} 掷骰</button>
          </div>
          <div class="dice-tools__row">
            <select class="form-input" id="check-skill" aria-label="检定技能">${skillOptions(
              selectedCharacter()
            )}</select>
            <select class="form-input" id="check-difficulty" aria-label="检定难度">
              <option value="regular">常规</option>
              <option value="hard">困难</option>
              <option value="extreme">极难</option>
            </select>
            <button class="btn btn--ghost btn--sm" type="button" data-action="quick-check">${icon(
              'dice'
            )} 检定</button>
            <button class="btn btn--ghost btn--sm" type="button" data-action="quick-san">SAN</button>
            <button class="btn btn--ghost btn--sm" type="button" data-action="show-command-help">/ 命令</button>
          </div>
        </div>
        <div class="composer">
          <textarea class="composer__input" id="chat-input" rows="3" placeholder="描述你的行动，或使用 /r /c /san /luck 命令……" ${
            sending || actorBusy ? 'disabled' : ''
          }></textarea>
          <div class="composer__bar">
            <span class="composer__hint">ENTER 发送 · SHIFT+ENTER 换行 · AI 代演：≤100字并自动检定</span>
            <div class="composer__actions">
              <button class="btn btn--gold btn--sm" type="button" data-action="ai-actor" ${
                !currentProfile || sending || actorBusy ? 'disabled' : ''
              }>${icon('spark')} ${actorBusy ? '代演中…' : 'AI 代演 ≤100字'}</button>
              <button class="btn btn--primary composer__send" type="button" data-action="send-message" ${
                sending || actorBusy ? 'disabled' : ''
              }>${icon('arrow-right')} 发送</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <aside class="play-kp">
      <div class="panel__head"><h2 class="panel__title">${icon('eye')} 守秘人状态</h2><span class="panel__meta">INTERNAL</span></div>
      ${renderKpSidebar()}
    </aside>
  </div>`;
}

/* =========================================================
 * 消息与滚动
 * ========================================================= */

function scrollChat() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function appendMessageDom(message) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = messageMarkup(message);
  const element = wrapper.firstElementChild;
  if (element) container.appendChild(element);
  scrollChat();
  return element;
}

async function persistChat() {
  if (!chat) return;
  chat.updatedAt = new Date().toISOString();
  chat.sceneId = campaign?.kpState?.currentSceneId || chat.sceneId || '';
  chat = await storage.chats.save(chat);
}

function addMessage(role, content, meta = {}, speaker = '') {
  const message = {
    id: createMessageId(),
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString(),
    ...(speaker ? { speaker } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
  };
  chat.messages.push(message);
  return message;
}

/* =========================================================
 * 骰子
 * ========================================================= */

function diceOptions() {
  const mode = document.getElementById('dice-mode')?.value || 'none';
  const count = Math.max(1, Math.min(2, Number(document.getElementById('dice-count')?.value) || 1));
  return {
    bonus: mode === 'bonus' ? count : 0,
    penalty: mode === 'penalty' ? count : 0,
    hidden: Boolean(document.getElementById('dice-hidden')?.checked),
  };
}

async function addDiceMessage(content, diceMeta, hidden = false) {
  const message = addMessage('dice', content, {
    dice: diceMeta,
    hidden,
    revealed: false,
  });
  appendMessageDom(message);
  await persistChat();
  return message;
}

async function rollFromTools(ctx) {
  if (!campaign) return;
  const expression = String(document.getElementById('dice-expression')?.value || '1d100').trim();
  const options = diceOptions();
  try {
    let meta;
    let text;
    if (/^1d100$/i.test(expression) && (options.bonus || options.penalty)) {
      const result = rollD100({ bonus: options.bonus, penalty: options.penalty });
      meta = { kind: 'expression', expression, ...result, bonus: options.bonus, penalty: options.penalty };
      text = `1D100 ${options.bonus ? `+${options.bonus} 奖励` : `+${options.penalty} 惩罚`} = ${
        result.roll
      }（候选：${result.candidates.map((candidate) => candidate.value).join(' / ')}）`;
    } else {
      const result = rollExpression(expression);
      meta = { kind: 'expression', ...result };
      text = result.text;
    }
    await addDiceMessage(text, meta, options.hidden);
    if (options.hidden) toast('暗骰结果已记录，仅 KP 可见。', { type: 'info' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function quickCheckFromTools() {
  const character = selectedCharacter();
  if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
  const skillName = document.getElementById('check-skill')?.value || '侦查';
  const difficulty = document.getElementById('check-difficulty')?.value || 'regular';
  const skill = (character.skills || []).find((item) => item.name === skillName);
  if (!skill) return toast('找不到这项技能。', { type: 'error' });
  const options = diceOptions();
  const result = cocCheck(skill.total, {
    bonus: options.bonus,
    penalty: options.penalty,
    difficulty,
  });
  const meta = { kind: 'check', check: result, skillName, difficulty };
  await addDiceMessage(
    `${character.name} · ${skillName} ${result.text}`,
    meta,
    options.hidden
  );
}

async function quickSanFromTools() {
  const character = selectedCharacter();
  if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
  const loss = window.prompt('SAN 损失表达式（成功/失败）', '1/1d6');
  if (!loss) return;
  const result = sanityCheck(character.derived?.san?.current ?? character.derived?.san?.max, {
    loss,
    int: character.attributes?.int,
  });
  const before = character.derived?.san?.current ?? character.derived?.san?.max ?? 0;
  const after = Math.max(0, before - result.loss);
  character.derived = character.derived || {};
  character.derived.san = { current: after, max: character.derived.san?.max ?? 99 };
  storage.characters.save(character);
  const meta = { kind: 'san', san: result };
  await addDiceMessage(`${character.name} · ${result.text}`, meta, false);
  if (document.querySelector('.roster-card.is-active .roster-card__state')) {
    document.querySelector('.roster-card.is-active .roster-card__state').textContent = `${after} SAN`;
  }
  if (result.temporaryInsanity) {
    toast('单次损失 ≥5：触发临时性疯狂判定，请让 KP 处理。', { type: 'warning', duration: 6000 });
  }
}

/* =========================================================
 * 发送与流式 KP
 * ========================================================= */

function setSendingUi(value) {
  sending = value;
  const sendButton = document.querySelector('[data-action="send-message"]');
  const input = document.getElementById('chat-input');
  if (sendButton) sendButton.disabled = value;
  if (input) input.disabled = value;
  const header = document.querySelector('.chat-head__actions');
  if (header) {
    const existing = header.querySelector('[data-action="abort-generation"]');
    if (value && !existing) {
      const button = document.createElement('button');
      button.className = 'btn btn--danger btn--sm';
      button.type = 'button';
      button.dataset.action = 'abort-generation';
      button.innerHTML = `${icon('x')} 停止`;
      header.prepend(button);
    } else if (!value && existing) {
      existing.remove();
    }
  }
}

async function recordTurnLog(userMessage, assistant) {
  if (!campaign) return;
  try {
    const scene = findScene(moduleData, campaign.kpState?.currentSceneId)?.scene;
    const userIndex = chat.messages.findIndex((message) => message.id === userMessage.id);
    const priorUserIndex = chat.messages
      .slice(0, Math.max(0, userIndex))
      .map((message) => message.role)
      .lastIndexOf('user');
    const turnSlice = chat.messages.slice(priorUserIndex + 1, userIndex);
    const recentDice = [...turnSlice].reverse().find((message) => message.role === 'dice');
    const content = [
      `【${userMessage.speaker || '调查员'}】${userMessage.content}`,
      recentDice ? `【骰子】${recentDice.content}` : '',
      `【KP】${assistant.content}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const entry = await storage.worldbook.save({
      campaignId: campaign.id,
      moduleId: campaign.moduleId,
      moduleTitle: moduleData?.title || campaign.moduleTitle || '',
      type: 'log',
      title: `${scene?.title || '场景'} · ${new Date().toLocaleString('zh-CN')}`,
      content,
      tags: [scene?.title, campaign.title, userMessage.speaker].filter(Boolean),
      characterIds: [selectedCharacterId].filter(Boolean),
      sceneId: campaign.kpState?.currentSceneId || '',
      source: 'turn',
      importance: 1,
      includeInContext: true,
    });
    worldbookEntries = [entry, ...worldbookEntries.filter((item) => item.id !== entry.id)].slice(0, 120);
  } catch (error) {
    console.warn('[Cthulhu Table] 跑团日志写入世界书失败：', error);
  }
}

async function runKpTurn(userMessage, ctx) {
  if (!currentProfile) {
    toast('尚未配置 AI 接口，无法请求守秘人。', { type: 'error', duration: 6000 });
    return;
  }
  if (!campaign || !moduleData) return;
  if (sending) return;

  const history = chat.messages.slice(0, -1);
  const context = buildKpContext({
    module: moduleData,
    state: campaign.kpState,
    characters,
    history,
    userInput: userMessage.content,
    worldbook: worldbookEntries,
    settings: storage.settings.get().kp,
  });

  const assistant = {
    id: createMessageId(),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    meta: { model: currentProfile.model, streaming: true },
  };
  chat.messages.push(assistant);
  const element = appendMessageDom(assistant);
  const textElement = element?.querySelector('[data-message-text]');
  element?.classList.add('is-streaming');
  setSendingUi(true);
  abortController = new AbortController();

  try {
    let result;
    if (currentProfile.stream === false) {
      result = await api.complete(currentProfile, context.messages, {
        signal: abortController.signal,
        useWebSearch: Boolean(currentProfile.webSearch?.enabled),
        retries: 1,
      });
      assistant.content = result.content;
      if (textElement) textElement.textContent = result.content;
      scrollChat();
    } else {
      result = await api.streamChat(currentProfile, context.messages, {
        signal: abortController.signal,
        useWebSearch: Boolean(currentProfile.webSearch?.enabled),
        retries: 1,
        onDelta: (delta, full) => {
          assistant.content = full;
          if (textElement) textElement.textContent = full;
          scrollChat();
        },
      });
    }

    const parsed = parseKpStateBlock(result.content);
    let merged = { state: campaign.kpState, warnings: [] };
    if (parsed.statePatch) {
      merged = mergeKpState(campaign.kpState, parsed.statePatch, moduleData);
    } else if (parsed.error) {
      toast(parsed.error, { type: 'warning', duration: 6000 });
    }
    assistant.content = parsed.narrative || result.content;
    assistant.meta = {
      ...assistant.meta,
      streaming: false,
      durationMs: result.durationMs,
      usage: result.usage,
      stateWarnings: merged.warnings,
    };
    chat.messages[chat.messages.length - 1] = assistant;
    campaign.kpState = merged.state;
    campaign.activeChapterId = merged.state.currentChapterId;
    campaign.activeSceneId = merged.state.currentSceneId;
    campaign.status = 'active';
    campaign.lastPlayedAt = new Date().toISOString();
    campaign.updatedAt = new Date().toISOString();
    campaign.chatIds = [chat.id];
    storage.campaigns.save(campaign);
    await persistChat();
    if (textElement) textElement.textContent = assistant.content;
    element?.classList.remove('is-streaming');
    updateKpPanel();
    if (merged.warnings.length) {
      console.warn('[Cthulhu Table] KP 状态警告：', merged.warnings);
    }
    if (!parsed.statePatch) {
      toast('KP 没有返回可解析的状态块，本回合状态未更新。', {
        type: 'warning',
        duration: 6000,
      });
    }
    await recordTurnLog(userMessage, assistant);
    // 重绘桌面，让场景标题、进度与线索面板与本回合状态同步。
    ctx?.refresh?.();
  } catch (error) {
    chat.messages = chat.messages.filter((message) => message.id !== assistant.id);
    element?.remove();
    if (error.name === 'AbortError') {
      toast('已停止生成本回合叙事。', { type: 'info' });
    } else {
      toast(`守秘人暂时沉默：${error.message}`, { type: 'error', duration: 7000 });
    }
    await persistChat();
  } finally {
    setSendingUi(false);
    abortController = null;
  }
}

function setActorBusy(value) {
  actorBusy = value;
  const button = document.querySelector('[data-action="ai-actor"]');
  const input = document.getElementById('chat-input');
  if (button) {
    button.disabled = value || sending || !currentProfile;
    button.innerHTML = value ? `${icon('spark')} 代演中…` : `${icon('spark')} AI 代演 ≤100字`;
  }
  if (input) input.disabled = value || sending;
}

async function runActorTurn(ctx) {
  if (actorBusy || sending) return;
  const character = selectedCharacter();
  if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
  if (!currentProfile) return toast('请先配置 AI 接口，才能使用 AI 代演。', { type: 'error' });
  if (!moduleData) return toast('当前战役没有模组。', { type: 'error' });
  setActorBusy(true);
  try {
    const action = await generateActorAction({
      profile: currentProfile,
      character,
      campaign,
      module: moduleData,
      chat,
      worldbook: worldbookEntries,
    });
    const skill = (character.skills || []).find((item) => item.name === action.skill);
    if (!skill) throw new Error(`角色没有技能「${action.skill}」。`);
    const check = cocCheck(skill.total, { difficulty: action.difficulty });
    // 先写入自动检定，再写入角色行动；让 KP 同时看到骰子与角色台词/动作。
    await addDiceMessage(
      `${character.name} · ${action.skill} ${check.text}`,
      { kind: 'check', check, skillName: action.skill, difficulty: action.difficulty },
      false
    );
    const message = addMessage(
      'user',
      action.reply,
      {
        aiActor: true,
        actorAction: action.action,
        characterId: character.id,
        autoCheck: { skill: action.skill, difficulty: action.difficulty, roll: check.roll },
      },
      character.name
    );
    appendMessageDom(message);
    await persistChat();
    setActorBusy(false);
    await runKpTurn(message, ctx);
  } catch (error) {
    toast(`AI 代演失败：${error.message}`, { type: 'error', duration: 7000 });
  } finally {
    setActorBusy(false);
  }
}

async function sendMessage(ctx) {
  const input = document.getElementById('chat-input');
  const text = String(input?.value || '').trim();
  if (!text) return;
  if (sending || actorBusy) return;
  if (text.startsWith('/')) {
    input.value = '';
    await handleCommand(text, ctx);
    return;
  }
  if (!currentProfile) {
    toast('请先在设置中配置 AI 接口，再向守秘人发送行动。', { type: 'error', duration: 6000 });
    return;
  }
  const character = selectedCharacter();
  const message = addMessage('user', text, {}, character?.name || '');
  input.value = '';
  appendMessageDom(message);
  await persistChat();
  await runKpTurn(message, ctx);
}

async function handleCommand(text, ctx) {
  const parts = text.trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const character = selectedCharacter();
  if (command === '/help' || command === '/?') {
    const message = addMessage(
      'system',
      '命令：/r <表达式> 掷骰；/c <技能> [常规|困难|极难] 检定；/san [成功/失败损失] SAN 检定；/luck <点数> 消耗幸运；/opp <技能> <对方技能值> 对抗检定。',
      {}
    );
    appendMessageDom(message);
    await persistChat();
    return;
  }
  if (command === '/r' || command === '/roll') {
    const expression = parts.join(' ') || '1d100';
    const options = diceOptions();
    try {
      let meta;
      let summary;
      if (/^1d100$/i.test(expression) && (options.bonus || options.penalty)) {
        const result = rollD100({ bonus: options.bonus, penalty: options.penalty });
        meta = { kind: 'expression', ...result };
        summary = `1D100 ${options.bonus ? `+${options.bonus} 奖励` : `+${options.penalty} 惩罚`} = ${
          result.roll
        }`;
      } else {
        const result = rollExpression(expression);
        meta = { kind: 'expression', ...result };
        summary = result.text;
      }
      await addDiceMessage(summary, meta, options.hidden);
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
    return;
  }
  if (command === '/c' || command === '/check') {
    if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
    const skillName = parts[0] || '侦查';
    const difficulty = DIFFICULTY_ALIASES[parts[1]] || 'regular';
    const skill = (character.skills || []).find((item) => item.name === skillName);
    if (!skill) return toast(`找不到技能「${skillName}」。`, { type: 'error' });
    const options = diceOptions();
    const result = cocCheck(skill.total, {
      bonus: options.bonus,
      penalty: options.penalty,
      difficulty,
    });
    await addDiceMessage(
      `${character.name} · ${skillName} ${result.text}`,
      { kind: 'check', check: result, skillName, difficulty },
      options.hidden
    );
    return;
  }
  if (command === '/san') {
    if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
    const loss = parts[0] || '1/1d6';
    const result = sanityCheck(character.derived?.san?.current ?? 50, {
      loss,
      int: character.attributes?.int,
    });
    const before = character.derived?.san?.current ?? 50;
    const after = Math.max(0, before - result.loss);
    character.derived.san = { current: after, max: character.derived.san?.max ?? 99 };
    storage.characters.save(character);
    await addDiceMessage(`${character.name} · ${result.text}`, { kind: 'san', san: result }, false);
    return;
  }
  if (command === '/luck') {
    if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
    const amount = Math.max(0, Math.floor(Number(parts[0]) || 0));
    const result = spendLuck(character.luck, amount);
    character.luck = result.remaining;
    storage.characters.save(character);
    const message = addMessage('system', `${character.name}：${result.text}`, {});
    appendMessageDom(message);
    await persistChat();
    return;
  }
  if (command === '/opp' || command === '/opposed') {
    if (!character) return toast('请先选择一位调查员。', { type: 'warning' });
    const skillName = parts[0] || '侦查';
    const passive = Math.max(0, Number(parts[1]) || 50);
    const skill = (character.skills || []).find((item) => item.name === skillName);
    if (!skill) return toast(`找不到技能「${skillName}」。`, { type: 'error' });
    const result = opposedCheck(skill.total, passive);
    await addDiceMessage(`${character.name} · 对抗检定 ${result.text}`, {
      kind: 'check',
      check: result.active,
      opposed: result,
      skillName,
    }, false);
    return;
  }
  toast('未知命令。输入 /help 查看可用命令。', { type: 'info' });
}

function updateKpPanel() {
  const panel = document.querySelector('.play-kp');
  if (!panel || !campaign) return;
  panel.innerHTML = `<div class="panel__head"><h2 class="panel__title">${icon(
    'eye'
  )} 守秘人状态</h2><span class="panel__meta">INTERNAL</span></div>${renderKpSidebar()}`;
}

/* =========================================================
 * 存档 / 导出
 * ========================================================= */

async function saveGame() {
  if (!campaign) return;
  const body = document.createElement('div');
  body.innerHTML = `<label class="form-field"><span class="form-field__label">存档名称</span><input class="form-input" id="save-name" value="${escapeHTML(
    `${campaign.title} · ${new Date().toLocaleString('zh-CN')}`
  )}"></label><p class="modal-copy muted">存档保存在 IndexedDB，包含当前战役、角色、聊天与 KP 状态。模组仍按 moduleId 关联。</p>`;
  openModal({
    eyebrow: 'Save Game',
    title: '保存当前战役',
    body,
    footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>取消</button><button class="btn btn--primary" type="button" data-save-confirm>保存</button></div>`,
    onMount: (dialog) => {
      dialog.querySelector('[data-save-confirm]')?.addEventListener('click', async () => {
        const name = dialog.querySelector('#save-name')?.value?.trim() || '未命名存档';
        const snapshot = {
          campaign: JSON.parse(JSON.stringify(campaign)),
          characters: characters.map((character) => JSON.parse(JSON.stringify(character))),
          chat: JSON.parse(JSON.stringify(chat)),
          moduleId: campaign.moduleId,
          kpState: JSON.parse(JSON.stringify(campaign.kpState)),
        };
        await storage.saves.save({ name, campaignId: campaign.id, snapshot });
        closeModal();
        toast('战役已存档。', { type: 'success' });
      });
    },
  });
}

async function showSaves(ctx) {
  const saves = await storage.saves.list(campaign?.id);
  if (!saves.length) {
    return toast('这个战役还没有存档。', { type: 'info' });
  }
  openModal({
    eyebrow: 'Save Archive',
    title: '读取存档',
    body: `<div class="save-list">${saves
      .map(
        (save) => `<div class="save-item">
          <div><strong>${escapeHTML(save.name)}</strong><p>${escapeHTML(
            new Date(save.createdAt).toLocaleString('zh-CN')
          )}</p></div>
          <div class="modal-actions"><button class="btn btn--gold btn--sm" type="button" data-action="load-save" data-save-id="${escapeHTML(
            save.id
          )}">读取</button><button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-save" data-save-id="${escapeHTML(
            save.id
          )}">${icon('trash', 'icon--sm')}</button></div>
        </div>`
      )
      .join('')}</div>`,
    footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>关闭</button></div>`,
  });
}

/* =========================================================
 * 视图
 * ========================================================= */

export const tableView = {
  async render() {
    await loadTableState();
    return renderTable();
  },

  async mount({ ctx }) {
    const input = document.getElementById('chat-input');
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage(ctx);
      }
    });
    const diceInput = document.getElementById('dice-expression');
    diceInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        rollFromTools(ctx);
      }
    });
    if (campaign) {
      if (!chat.createdAt) chat.createdAt = new Date().toISOString();
      if (!campaign.chatIds?.includes(chat.id)) {
        campaign.chatIds = [chat.id];
        storage.campaigns.save(campaign);
      }
      if (!(await storage.chats.get(chat.id))) await persistChat();
    }
    scrollChat();
  },

  actions: {
    async 'select-character'(element, ctx) {
      selectedCharacterId = element.dataset.characterId;
      ctx.refresh();
    },

    async 'roll-dice'(element, ctx) {
      await rollFromTools(ctx);
    },

    async 'quick-check'() {
      await quickCheckFromTools();
    },

    async 'quick-san'() {
      await quickSanFromTools();
    },

    async 'send-message'(element, ctx) {
      await sendMessage(ctx);
    },

    async 'ai-actor'(element, ctx) {
      await runActorTurn(ctx);
    },

    async 'abort-generation'() {
      abortController?.abort();
    },

    async 'reveal-dice'(element) {
      const message = chat?.messages.find((item) => item.id === element.dataset.messageId);
      if (!message) return;
      message.meta = { ...(message.meta || {}), revealed: true };
      await persistChat();
      element.closest('.chat-message')?.replaceWith(
        (() => {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = messageMarkup(message);
          return wrapper.firstElementChild;
        })()
      );
      toast('暗骰已揭示。', { type: 'info' });
    },

    async 'dice-to-kp'(element, ctx) {
      const diceMessage = chat?.messages.find((item) => item.id === element.dataset.messageId);
      if (!diceMessage) return;
      if (!currentProfile) {
        return toast('请先配置 AI 接口。', { type: 'error' });
      }
      const userMessage = addMessage(
        'user',
        `【检定结果】${diceMessage.content}\n请依据这个结果继续描述可观察的后果。`,
        {},
        selectedCharacter()?.name || ''
      );
      appendMessageDom(userMessage);
      await persistChat();
      await runKpTurn(userMessage, ctx);
    },

    async 'show-command-help'() {
      openModal({
        eyebrow: 'Table Commands',
        title: '桌面命令',
        body: `<ul class="modal-list">
          <li><code>/r 1d100</code> 掷骰；支持 3d6、4d6k3、1d8+1d4+2。</li>
          <li><code>/c 侦查</code> 或 <code>/c 侦查 困难</code> 进行一次技能检定。</li>
          <li><code>/san 1/1d6</code> 进行 SAN 检定并扣除理智。</li>
          <li><code>/luck 10</code> 消耗 10 点幸运。</li>
          <li><code>/opp 侦查 60</code> 与技能值 60 的对手进行对抗检定。</li>
        </ul><p class="modal-copy">骰子结果会写入聊天记录，并作为 KP 上下文的一部分。</p>`,
        footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>知道了</button></div>`,
      });
    },

    async 'view-kp-state'() {
      openModal({
        eyebrow: 'Keeper State',
        title: 'KP 内部状态 JSON',
        body: `<pre class="code-block">${escapeHTML(
          JSON.stringify(campaign?.kpState || {}, null, 2)
        )}</pre>`,
        footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>关闭</button></div>`,
      });
    },

    async 'manage-chat'(element, ctx) {
      if (!chat) return;
      const body = document.createElement('div');
      body.innerHTML = `<label class="form-field"><span class="form-field__label">聊天记录名称</span><input class="form-input" id="chat-title" value="${escapeHTML(
        chat.title
      )}"></label>
      <p class="modal-copy">当前记录包含 ${chat.messages.length} 条消息。导出为 JSON 后可以在外部归档。</p>
      <div class="modal-actions">
        <button class="btn btn--gold" type="button" data-chat-save>${icon('check')} 保存名称</button>
        <button class="btn btn--ghost" type="button" data-chat-export>${icon('download')} 导出聊天</button>
        <button class="btn btn--danger" type="button" data-chat-delete>${icon('trash')} 删除记录</button>
      </div>`;
      openModal({
        eyebrow: 'Chat Log',
        title: '聊天记录管理',
        body,
        footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>关闭</button></div>`,
        onMount: (dialog) => {
          dialog.querySelector('[data-chat-save]')?.addEventListener('click', async () => {
            chat.title = dialog.querySelector('#chat-title')?.value?.trim() || chat.title;
            await persistChat();
            closeModal();
            toast('聊天记录名称已更新。', { type: 'success' });
          });
          dialog.querySelector('[data-chat-export]')?.addEventListener('click', () => {
            downloadFile(
              `${sanitizeFilename(chat.title, 'chat')}-聊天记录.json`,
              JSON.stringify(chat, null, 2)
            );
            toast('聊天记录已导出。', { type: 'success' });
          });
          dialog.querySelector('[data-chat-delete]')?.addEventListener('click', async () => {
            const ok = await confirmDialog({
              eyebrow: '删除聊天记录',
              title: '删除当前聊天记录？',
              message: '这会删除本战役的全部对话与骰子记录，KP 状态和角色卡会保留。该操作无法撤销。',
              confirmLabel: '删除记录',
              danger: true,
            });
            if (!ok) return;
            await storage.chats.remove(chat.id);
            campaign.chatIds = [];
            storage.campaigns.save(campaign);
            closeModal();
            toast('聊天记录已删除，下一回合会创建新的记录。', { type: 'success' });
            ctx.refresh();
          });
        },
      });
    },

    async 'finalize-campaign'(element, ctx) {
      if (!campaign) return;
      const ok = await confirmDialog({
        eyebrow: '结束战役',
        title: `完结《${campaign.title}》并总结角色记忆？`,
        message:
          'AI 会把本场模组压缩成每位调查员的长期记忆，写给角色卡与世界书；之后仍可查看本场记录。若接口不可用，会用 KP 状态生成基础记忆。',
        confirmLabel: '总结并完结',
        danger: false,
      });
      if (!ok) return;
      const button = element;
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = '总结记忆…';
      try {
        const result = await summarizeCampaignMemories({
          profile: currentProfile,
          campaign,
          module: moduleData,
          characters,
          chat,
          worldbook: worldbookEntries,
        });
        const updated = attachMemoriesToCharacters(characters, result.memories, {
          campaign,
          module: moduleData,
        });
        for (const character of updated) storage.characters.save(character);

        // 清理本战役旧的 memory 世界书条目，避免重复总结堆积。
        const oldEntries = await storage.worldbook
          .list({ campaignId: campaign.id, type: 'memory' })
          .catch(() => []);
        for (const entry of oldEntries) await storage.worldbook.remove(entry.id);
        for (const memory of result.memories) {
          const character = updated.find((item) => item.id === memory.characterId);
          if (!character) continue;
          await storage.worldbook.save(
            memoryToWorldbookEntry(memory, character, { campaign, module: moduleData })
          );
        }

        campaign.status = 'completed';
        campaign.completedAt = new Date().toISOString();
        campaign.memorySummaries = result.memories;
        campaign.updatedAt = new Date().toISOString();
        storage.campaigns.save(campaign);

        openModal({
          eyebrow: 'Campaign Complete',
          title: '角色记忆已写入世界书',
          body: `<p class="modal-copy">${
            result.aiCount
              ? `已由 AI 总结 ${result.aiCount} 位调查员的记忆。`
              : `AI 总结未完成，已使用本地状态生成记忆${result.error ? `：${escapeHTML(result.error)}` : ''}。`
          }</p>
          <div class="memory-list">${result.memories
            .map((memory) => {
              const character = updated.find((item) => item.id === memory.characterId);
              return `<article class="memory-item"><div class="memory-item__head"><strong>${escapeHTML(
                character?.name || memory.characterId
              )}</strong></div><p class="memory-item__summary">${escapeHTML(
                memory.summary
              )}</p></article>`;
            })
            .join('')}</div>
          <p class="modal-copy muted">下一次选择同一调查员开始新模组时，这些记忆会自动进入 KP 与 AI 代演上下文。</p>`,
          footer: `<div class="modal-actions"><a class="btn btn--gold" href="#/worldbook">${icon(
            'book'
          )} 打开世界书</a><button class="btn btn--primary" type="button" data-close-dialog>完成</button></div>`,
        });
        ctx.refresh();
      } catch (error) {
        toast(`总结记忆失败：${error.message}`, { type: 'error', duration: 7000 });
      } finally {
        button.disabled = false;
        button.innerHTML = original;
      }
    },

    async 'save-game'() {
      await saveGame();
    },

    async 'show-saves'(element, ctx) {
      await showSaves(ctx);
    },

    async 'load-save'(element, ctx) {
      const save = await storage.saves.get(element.dataset.saveId);
      if (!save?.snapshot) return toast('存档损坏。', { type: 'error' });
      const snapshot = save.snapshot;
      const restored = storage.campaigns.save(snapshot.campaign);
      for (const character of snapshot.characters || []) {
        storage.characters.save(character);
      }
      if (snapshot.chat) await storage.chats.save(snapshot.chat);
      storage.campaigns.setActive(restored.id);
      closeModal();
      toast(`已读取存档：${save.name}`, { type: 'success' });
      ctx.navigate('#/table');
    },

    async 'delete-save'(element, ctx) {
      const ok = await confirmDialog({
        eyebrow: '删除存档',
        title: '删除这份存档？',
        message: '只会删除存档快照，不影响当前战役。',
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
      await storage.saves.remove(element.dataset.saveId);
      closeModal();
      toast('存档已删除。', { type: 'success' });
      ctx.refresh();
    },

    async 'export-campaign'(element, ctx) {
      if (!campaign) return;
      const bundle = await storage.backup.exportCampaign(campaign.id);
      downloadFile(
        `${sanitizeFilename(campaign.title, 'campaign')}-战役备份.json`,
        JSON.stringify(bundle, null, 2)
      );
      toast('战役备份已导出（包含聊天、角色与 KP 状态）。', { type: 'success' });
    },
  },
};

export default tableView;
