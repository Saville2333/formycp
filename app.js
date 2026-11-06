/**
 * app.js — 应用入口、Hash 路由、全局交互与启动流程
 *
 * 页面视图拆分在 js/views/，业务规则在 dice/character/api/module/kp。
 */

import { storage } from './storage.js';
import { homeView } from './views/home-view.js';
import { characterView } from './views/character-view.js';
import { moduleView } from './views/module-view.js';
import { tableView } from './views/table-view.js';
import { worldbookView } from './views/worldbook-view.js';
import { settingsView } from './views/settings-view.js';
import { escapeHTML, icon, toast } from './ui.js';

const view = document.getElementById('main-content');
const topbarTitle = document.getElementById('topbar-title');
const sidebar = document.getElementById('sidebar');
const menuButton = document.querySelector('[data-action="open-nav"]');
const bootScreen = document.getElementById('boot-screen');
const bootNote = document.getElementById('boot-note');
const bootHint = document.getElementById('file-protocol-hint');
const bootStartedAt = performance.now();

let currentPath = '/home';
let currentQuery = new URLSearchParams();
let renderSequence = 0;

const ROUTES = {
  '/home': { title: '战役总览', view: homeView },
  '/characters': {
    title: '调查员名册',
    view: {
      render: () => characterView.renderList(),
      mount: () => characterView.mountList(buildContext()),
    },
  },
  '/builder': {
    title: '车卡工坊',
    view: {
      render: ({ query }) => characterView.renderBuilder(query),
      mount: () => characterView.mountBuilder(buildContext()),
    },
  },
  '/modules': { title: '模组档案', view: moduleView },
  '/table': { title: '跑团桌面', view: tableView },
  '/worldbook': { title: '世界书', view: worldbookView },
  '/settings': { title: '设置与接口', view: settingsView },
};

const ACTION_HANDLERS = Object.freeze({
  ...characterView.actions,
  ...moduleView.actions,
  ...tableView.actions,
  ...worldbookView.actions,
  ...settingsView.actions,
});

/* =========================================================
 * 路由与外壳
 * ========================================================= */

function parseLocation() {
  const raw = window.location.hash.replace(/^#/, '') || '/home';
  const [rawPath, queryString = ''] = raw.split('?');
  const path = (rawPath || '/home').startsWith('/') ? rawPath || '/home' : `/${rawPath}`;
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return { path: normalized, query: new URLSearchParams(queryString) };
}

function updateActiveNav(path) {
  document.querySelectorAll('.nav__link[data-route]').forEach((link) => {
    const active = link.dataset.route === path;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateShell() {
  const count = storage.characters.count();
  document.querySelectorAll('[data-nav-count="characters"]').forEach((element) => {
    element.textContent = String(count);
  });
  const active = storage.campaigns.getActive();
  const title = document.querySelector('.sidebar .campaign-slot__title');
  const link = document.querySelector('.sidebar .campaign-slot__link');
  if (title) title.textContent = active ? active.title : '尚无进行中的战役';
  if (link) {
    link.href = active ? '#/table' : '#/modules';
    link.innerHTML = active
      ? `回到牌桌 ${icon('arrow-right', 'icon--sm')}`
      : `选择一份模组 ${icon('arrow-right', 'icon--sm')}`;
  }
  const dot = document.querySelector('.nav__link[data-route="/table"] .nav__dot');
  if (dot) {
    dot.classList.toggle('is-live', Boolean(active));
    dot.title = active ? '战役进行中' : '尚未开始';
  }
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

function syncNavAccessibility() {
  if (!sidebar) return;
  const desktop = window.matchMedia('(min-width: 1021px)').matches;
  const isOpen = document.body.classList.contains('nav-open');
  sidebar.toggleAttribute('inert', !desktop && !isOpen);
}

function buildContext() {
  return {
    query: currentQuery,
    path: currentPath,
    navigate: (target) => {
      const hash = String(target || '#/home').startsWith('#') ? String(target) : `#${target}`;
      if (window.location.hash === hash) {
        renderRoute({ animate: false, scroll: false }).catch(handleRouteError);
        return;
      }
      window.location.hash = hash;
    },
    refresh: () => renderRoute({ animate: false, scroll: false }).catch(handleRouteError),
    toast,
  };
}

function renderError(error) {
  console.error('[Cthulhu Table] 页面渲染失败：', error);
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">Something Went Wrong</p>
      <h1 class="page-title">这一页被雾气吞没了</h1>
      <p class="page-lede">页面渲染失败。你的本地数据没有丢失。可以返回总览，或打开控制台查看错误。</p>
    </div>
    <div class="page-head__actions"><a class="btn btn--primary" href="#/home">${icon(
      'home'
    )} 返回总览</a></div>
  </header>
  <div class="empty-state">
    <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
    <h2 class="empty-state__title">错误详情</h2>
    <p class="empty-state__text">${escapeHTML(error?.message || '未知错误')}</p>
  </div>`;
}

function renderNotFound() {
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">Lost in the Archives</p>
      <h1 class="page-title">这条走廊不在档案里</h1>
      <p class="page-lede">你推开了一扇不该存在的门。回到有灯的地方，或者从总览重新开始调查。</p>
    </div>
    <div class="page-head__actions"><a class="btn btn--primary" href="#/home">${icon(
      'home'
    )} 返回总览</a></div>
  </header>
  <div class="empty-state">
    <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
    <h2 class="empty-state__title">404 · 路径未收录</h2>
    <p class="empty-state__text">所有进度仍安全保存在本地，不会因为一次迷路而丢失。</p>
  </div>`;
}

async function renderRoute({ animate = true, scroll = true } = {}) {
  const { path, query } = parseLocation();
  currentPath = path;
  currentQuery = query;
  const route = ROUTES[path];
  const sequence = ++renderSequence;

  updateActiveNav(path);
  const title = route?.title || '路径未收录';
  topbarTitle.textContent = title;
  document.title = `${title} · Cthulhu Table`;
  updateShell();

  try {
    const html = route?.view?.render
      ? await route.view.render({ path, query })
      : renderNotFound();
    if (sequence !== renderSequence) return;
    view.innerHTML = html;
  } catch (error) {
    if (sequence !== renderSequence) return;
    view.innerHTML = renderError(error);
  }

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

  if (route?.view?.mount) {
    try {
      await route.view.mount({ path, query, ctx: buildContext() });
    } catch (error) {
      console.error('[Cthulhu Table] 页面挂载失败：', error);
      if (sequence === renderSequence) {
        toast('页面数据加载不完整，请刷新后重试。', { type: 'error' });
      }
    }
  }
}

function handleRouteError(error) {
  console.error(error);
  toast('路由渲染失败，请刷新重试。', { type: 'error' });
}

/* =========================================================
 * 全局事件
 * ========================================================= */

async function handleAction(action, element) {
  if (action === 'open-nav') return openNav();
  if (action === 'close-nav') return closeNav({ restoreFocus: true });
  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    console.warn(`[Cthulhu Table] 未处理的动作：${action}`);
    return;
  }
  await handler(element, buildContext());
}

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
    renderRoute().catch(handleRouteError);
  });

  window.addEventListener('cthulhu:characters-changed', updateShell);
  window.addEventListener('cthulhu:campaigns-changed', updateShell);
  window.addEventListener('storage', (event) => {
    if (event.key?.includes('cthulhu-table')) updateShell();
  });

  const desktopQuery = window.matchMedia('(min-width: 1021px)');
  desktopQuery.addEventListener?.('change', (event) => {
    if (event.matches) closeNav({ restoreFocus: false });
    syncNavAccessibility();
  });
}

/* =========================================================
 * 启动
 * ========================================================= */

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
  document.documentElement.dataset.reduceMotion = settings.app.reduceMotion ? 'true' : 'false';
  bindGlobalEvents();
  syncNavAccessibility();
  updateShell();

  if (!window.location.hash) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', `${base}#/home`);
  }

  const routeReady = renderRoute({ animate: false, scroll: false });
  finishBoot();
  await routeReady;

  if (!storage.diagnostics.isLocalStorageAvailable()) {
    window.setTimeout(() => {
      toast('localStorage 不可用，本次数据只会保留在内存中。关闭页面后将丢失。', {
        type: 'error',
        title: '存储警告',
        duration: 9000,
      });
    }, 500);
  }
}

boot().catch(showFatalError);
