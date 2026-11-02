/**
 * ui.js — 与业务无关的界面工具
 *
 * 负责：HTML 转义、图标、时间格式化、Toast、原生 <dialog> 弹窗、下载文件。
 * 页面模板集中在 app.js；本文件不读取任何角色或模组数据。
 */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** 所有插入 innerHTML 的外部文本都必须先经过这里。 */
export function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${escapeHTML(
    name
  )}"></use></svg>`;
}

export function getInitials(name) {
  const characters = Array.from(String(name || '').trim());
  if (!characters.length) return '？';
  const isCjk = /[\u3400-\u9fff]/.test(characters[0]);
  if (isCjk) return characters.slice(0, 1).join('');
  return characters
    .filter((character) => /\p{L}/u.test(character))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 45) return '刚刚';
  if (absolute < 3600) return `${Math.round(absolute / 60)} 分钟前`;
  if (absolute < 86400) return `${Math.round(absolute / 3600)} 小时前`;
  if (absolute < 86400 * 7) return `${Math.round(absolute / 86400)} 天前`;
  return formatDate(date);
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  return `${size >= 100 || exponent === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[exponent]}`;
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN').format(number);
}

/* =========================================================
 * Toast
 * ========================================================= */

const toastIcons = {
  info: 'spark',
  success: 'check',
  error: 'alert',
};

export function toast(message, { type = 'info', title = '', duration = 3800 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return () => {};

  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'toast__icon';
  iconWrap.innerHTML = icon(toastIcons[type] || toastIcons.info, 'icon--sm');

  const body = document.createElement('div');
  body.className = 'toast__body';
  if (title) {
    const titleElement = document.createElement('strong');
    titleElement.className = 'toast__title';
    titleElement.textContent = title;
    body.appendChild(titleElement);
  }
  const messageElement = document.createElement('span');
  messageElement.className = 'toast__message';
  messageElement.textContent = String(message ?? '');
  body.appendChild(messageElement);

  element.append(iconWrap, body);
  region.appendChild(element);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    element.classList.add('is-leaving');
    window.setTimeout(() => element.remove(), 260);
  };

  const timer = window.setTimeout(remove, Math.max(1200, duration));
  element.addEventListener('click', () => {
    window.clearTimeout(timer);
    remove();
  });
  return remove;
}

/* =========================================================
 * 原生 <dialog> 弹窗
 * ========================================================= */

const dialog = document.getElementById('app-dialog');
const dialogTitle = document.getElementById('modal-title');
const dialogEyebrow = document.getElementById('modal-eyebrow');
const dialogBody = document.getElementById('modal-body');
const dialogFoot = document.getElementById('modal-foot');
let dialogOnClose = null;
let previousFocus = null;
let dialogBound = false;

function runDialogOnClose() {
  const callback = dialogOnClose;
  dialogOnClose = null;
  if (typeof callback === 'function') callback();
}

function bindDialogOnce() {
  if (dialogBound || !dialog) return;
  dialogBound = true;

  dialog.addEventListener('close', runDialogOnClose);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeModal();
  });

  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) closeModal();
  });
}

export function openModal({
  eyebrow = 'Cthulhu Table',
  title = '',
  body = '',
  footer = '',
  onClose = null,
  onMount = null,
} = {}) {
  if (!dialog) return;
  bindDialogOnce();

  // 如果已有弹窗，先无回调关闭，避免旧 Promise 被误结算。
  if (dialog.open) {
    const oldCallback = dialogOnClose;
    dialogOnClose = null;
    dialog.close();
    if (oldCallback) oldCallback();
  }

  previousFocus = document.activeElement;
  dialogEyebrow.textContent = eyebrow;
  dialogTitle.textContent = title;
  dialogFoot.hidden = !footer;

  if (body instanceof Node) {
    dialogBody.replaceChildren(body);
  } else {
    dialogBody.innerHTML = body;
  }

  if (footer instanceof Node) {
    dialogFoot.replaceChildren(footer);
  } else {
    dialogFoot.innerHTML = footer;
  }

  dialogOnClose = onClose;
  dialog.showModal();
  const focusTarget = dialog.querySelector('.modal__close');
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  if (typeof onMount === 'function') onMount(dialog);
  return dialog;
}

export function closeModal() {
  if (!dialog || !dialog.open) return;
  dialog.close();
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus({ preventScroll: true });
  }
  previousFocus = null;
}

export function confirmDialog({
  eyebrow = '需要确认',
  title = '确定继续吗？',
  message = '',
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      eyebrow,
      title,
      body: `<p class="modal-copy">${escapeHTML(message)}</p>`,
      footer: `
        <div class="modal-actions">
          <button class="btn btn--ghost" type="button" data-confirm-cancel>${escapeHTML(
            cancelLabel
          )}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm-ok>${escapeHTML(
            confirmLabel
          )}</button>
        </div>`,
      onClose: () => finish(false),
      onMount: (element) => {
        const cancelButton = element.querySelector('[data-confirm-cancel]');
        const confirmButton = element.querySelector('[data-confirm-ok]');
        cancelButton?.addEventListener('click', () => {
          finish(false);
          closeModal();
        });
        confirmButton?.addEventListener('click', () => {
          finish(true);
          closeModal();
        });
        confirmButton?.focus({ preventScroll: true });
      },
    });
  });
}

/* =========================================================
 * 文件下载
 * ========================================================= */

export function downloadFile(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function sanitizeFilename(name, fallback = 'cthulhu-table') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function debounce(callback, delay = 250) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}
