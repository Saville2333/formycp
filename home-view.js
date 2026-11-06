/**
 * home-view.js — 战役总览
 */

import { storage } from '../storage.js';
import {
  escapeHTML,
  safeText,
  icon,
  getInitials,
  formatNumber,
  formatRelative,
} from '../ui.js';

function recentItem(character) {
  return `
    <button class="recent-item" type="button" data-action="view-character" data-character-id="${escapeHTML(
      character.id
    )}">
      <span class="recent-item__portrait">${escapeHTML(getInitials(character.name))}</span>
      <span class="recent-item__body">
        <span class="recent-item__name">${escapeHTML(character.name)}</span>
        <span class="recent-item__meta">${escapeHTML(
          [character.occupation, `${character.age} 岁`, character.gender].filter(Boolean).join(' · ')
        )}</span>
      </span>
      <span class="recent-item__side">${escapeHTML(formatRelative(character.updatedAt))}${icon(
        'arrow-up-right',
        'icon--sm'
      )}</span>
    </button>`;
}

export const homeView = {
  async render() {
    const [characters, stats, settings] = await Promise.all([
      Promise.resolve(storage.characters.list()),
      storage.diagnostics.stats().catch(() => ({ characters: 0, modules: 0, chats: 0 })),
      Promise.resolve(storage.settings.get()),
    ]);
    const active = storage.campaigns.getActive();
    const recent = characters.slice(0, 3);
    const activeMarkup = active
      ? `<div class="campaign-banner">
          <div>
            <p class="campaign-banner__label">正在进行</p>
            <h2 class="campaign-banner__title">${escapeHTML(active.title)}</h2>
            <p class="campaign-banner__meta">${escapeHTML(
              active.moduleTitle || '未绑定模组'
            )} · ${escapeHTML(statusLabel(active.status))}</p>
          </div>
          <a class="btn btn--primary" href="#/table">继续调查 ${icon('arrow-right')}</a>
        </div>`
      : '';

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
            <span class="oracle-rune"></span><span class="oracle-rune"></span>
            <span class="oracle-rune"></span><span class="oracle-rune"></span>
          </div>
          <img class="oracle-sigil" src="assets/sigil.svg" alt="">
          <span class="oracle-mark oracle-mark--left">ARKHAM · 1928</span>
          <span class="oracle-mark oracle-mark--right">KEEP THE SECRET</span>
          <p class="oracle-caption">The secret must be kept</p>
        </div>
      </section>

      ${activeMarkup}

      <section class="stat-grid" aria-label="战役数据概览">
        <article class="stat-card">
          <span class="stat-card__icon">${icon('users')}</span>
          <span class="stat-card__body">
            <span class="stat-card__value">${formatNumber(characters.length)}</span>
            <span class="stat-card__label">调查员档案</span>
            <span class="stat-card__hint">PL 与 NPC 共用同一套数据结构</span>
          </span>
        </article>
        <article class="stat-card">
          <span class="stat-card__icon">${icon('book')}</span>
          <span class="stat-card__body">
            <span class="stat-card__value">${formatNumber(stats.modules || 0)}</span>
            <span class="stat-card__label">本地模组</span>
            <span class="stat-card__hint">原文只写入 IndexedDB</span>
          </span>
        </article>
        <article class="stat-card">
          <span class="stat-card__icon">${icon('table')}</span>
          <span class="stat-card__body">
            <span class="stat-card__value">${formatNumber(stats.chats || 0)}</span>
            <span class="stat-card__label">对话记录</span>
            <span class="stat-card__hint">按战役与场景归档</span>
          </span>
        </article>
      </section>

      <div class="home-grid">
        <section class="panel" aria-labelledby="recent-title">
          <div class="panel__head">
            <h2 class="panel__title" id="recent-title">${icon('scroll')} 最近的调查员</h2>
            <a class="section-head__link" href="#/characters">全部名册 ${icon('arrow-right')}</a>
          </div>
          ${
            recent.length
              ? `<div class="recent-list">${recent.map(recentItem).join('')}</div>`
              : `<div class="empty-state empty-state--compact">
                  <p class="empty-state__text">名册还是空的。载入两位示例调查员，先看看一张完整的人设卡长什么样。</p>
                  <div class="empty-state__actions">
                    <button class="btn btn--gold btn--sm" type="button" data-action="load-sample">${icon(
                      'spark'
                    )} 载入示例</button>
                    <a class="btn btn--ghost btn--sm" href="#/builder">新建调查员</a>
                  </div>
                </div>`
          }
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
                  characters.length ? `已有 ${characters.length} 份档案。` : '载入示例或创建第一份档案。'
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
              <span class="preflight__status">${stats.modules ? 'READY' : 'WAIT'}</span>
            </li>
            <li class="preflight__item">
              <span class="preflight__index">03</span>
              <div class="preflight__body">
                <p class="preflight__title">连接守秘人</p>
                <p class="preflight__desc">${
                  settings.api.profiles.length
                    ? `已保存 ${settings.api.profiles.length} 套接口配置。`
                    : '配置一个 OpenAI 兼容接口，开启 AI KP。'
                }</p>
              </div>
              <span class="preflight__status">${
                settings.api.profiles.length ? 'READY' : 'STAGE 3'
              }</span>
            </li>
          </ol>
          <div class="campaign-slot" style="margin-top:18px;">
            <p class="campaign-slot__label">快速入口</p>
            <p class="campaign-slot__title">${
              active ? `继续《${escapeHTML(active.title)}》` : '尚未创建战役'
            }</p>
            <a class="campaign-slot__link" href="${active ? '#/table' : '#/modules'}">
              ${active ? '回到牌桌' : '选择一份模组'} ${icon('arrow-right', 'icon--sm')}
            </a>
          </div>
        </aside>
      </div>`;
  },
};

function statusLabel(status) {
  return (
    {
      setup: '准备中',
      active: '进行中',
      paused: '暂停',
      completed: '已完结',
    }[status] || '准备中'
  );
}

export default homeView;
