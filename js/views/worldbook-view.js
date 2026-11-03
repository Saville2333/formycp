/**
 * worldbook-view.js — 世界书：跨战役日志、角色记忆与手动设定
 */

import { storage } from '../storage.js';
import {
  escapeHTML,
  icon,
  formatDateTime,
  downloadFile,
  sanitizeFilename,
  toast,
  openModal,
  closeModal,
  confirmDialog,
} from '../ui.js';

const TYPE_LABELS = {
  log: '跑团日志',
  memory: '角色记忆',
  npc: 'NPC',
  location: '地点',
  clue: '线索',
  event: '事件',
  note: '笔记',
};

function pageHead(actions = '') {
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">The World Book</p>
      <h1 class="page-title">世界书</h1>
      <p class="page-lede">
        跑团日志、角色跨模组记忆与手动设定集中在这里。KP 会检索相关条目，让不同模组之间保持连续性。
      </p>
    </div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
  </header>`;
}

function entryCard(entry) {
  const typeLabel = TYPE_LABELS[entry.type] || entry.type;
  return `<article class="worldbook-card" data-worldbook-id="${escapeHTML(entry.id)}" data-search="${escapeHTML(
    `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')} ${entry.moduleTitle}`.toLowerCase()
  )}">
    <div class="worldbook-card__head">
      <span class="worldbook-type worldbook-type--${escapeHTML(entry.type)}">${escapeHTML(typeLabel)}</span>
      <span class="worldbook-card__title">${escapeHTML(entry.title)}</span>
      <span class="panel__meta">${escapeHTML(entry.moduleTitle || '未绑定模组')}</span>
    </div>
    <p class="worldbook-card__content">${escapeHTML(entry.content.slice(0, 420))}${
      entry.content.length > 420 ? '…' : ''
    }</p>
    <div class="worldbook-card__foot">
      <span>${escapeHTML(formatDateTime(entry.createdAt))}</span>
      <span class="worldbook-card__tags">${(entry.tags || [])
        .slice(0, 5)
        .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
        .join('')}</span>
      <span class="worldbook-card__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-action="edit-worldbook" data-worldbook-id="${escapeHTML(
          entry.id
        )}">${icon('edit')} 编辑</button>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-worldbook" data-worldbook-id="${escapeHTML(
          entry.id
        )}" title="删除条目">${icon('trash', 'icon--sm')}</button>
      </span>
    </div>
  </article>`;
}

function groupEntries(entries, type) {
  return entries.filter((entry) => entry.type === type);
}

export const worldbookView = {
  async render() {
    const entries = await storage.worldbook.list().catch(() => []);
    const memoryEntries = groupEntries(entries, 'memory');
    const logEntries = groupEntries(entries, 'log');
    const otherEntries = entries.filter((entry) => !['memory', 'log'].includes(entry.type));
    return `${pageHead(
      `<button class="btn btn--primary" type="button" data-action="new-worldbook">${icon(
        'plus'
      )} 新建条目</button><button class="btn btn--ghost" type="button" data-action="export-worldbook">${icon(
        'download'
      )} 导出</button>`
    )}
    <div class="worldbook-toolbar">
      <label class="form-field">
        <span class="form-field__label">搜索世界书</span>
        <input class="form-input" id="worldbook-search" placeholder="搜索标题、正文、标签……">
      </label>
      <div class="worldbook-stats">
        <span><strong>${memoryEntries.length}</strong> 记忆</span>
        <span><strong>${logEntries.length}</strong> 日志</span>
        <span><strong>${otherEntries.length}</strong> 笔记</span>
      </div>
    </div>
    ${
      entries.length
        ? `<section class="worldbook-section">
            <div class="section-head"><h2 class="section-head__title">角色记忆</h2><span class="panel__meta">${memoryEntries.length}</span></div>
            ${memoryEntries.length ? `<div class="worldbook-list">${memoryEntries.map(entryCard).join('')}</div>` : '<p class="empty-hint">完成一个模组后会自动生成。</p>'}
          </section>
          <section class="worldbook-section">
            <div class="section-head"><h2 class="section-head__title">跑团日志</h2><span class="panel__meta">${logEntries.length}</span></div>
            ${logEntries.length ? `<div class="worldbook-list">${logEntries.map(entryCard).join('')}</div>` : '<p class="empty-hint">每个 KP 回合结束后会自动写入一条日志。</p>'}
          </section>
          <section class="worldbook-section">
            <div class="section-head"><h2 class="section-head__title">世界设定与笔记</h2><span class="panel__meta">${otherEntries.length}</span></div>
            ${otherEntries.length ? `<div class="worldbook-list">${otherEntries.map(entryCard).join('')}</div>` : '<p class="empty-hint">可以手动添加地点、NPC、线索或设定。</p>'}
          </section>`
        : `<div class="empty-state">
            <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
            <h2 class="empty-state__title">世界书还是空白的</h2>
            <p class="empty-state__text">开始跑团后，每回合日志会自动写入；完成模组后，角色记忆也会写在这里。你也可以手动添加世界设定。</p>
            <div class="empty-state__actions">
              <button class="btn btn--gold" type="button" data-action="new-worldbook">${icon(
                'plus'
              )} 写第一条设定</button>
              <a class="btn btn--ghost" href="#/table">回到跑团桌面</a>
            </div>
          </div>`
    }`;
  },

  async mount() {
    const search = document.getElementById('worldbook-search');
    search?.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      document.querySelectorAll('.worldbook-card').forEach((card) => {
        card.hidden = Boolean(query) && !card.dataset.search.includes(query);
      });
    });
  },

  actions: {
    async 'new-worldbook'(element, ctx) {
      openWorldbookEditor(null, ctx);
    },

    async 'edit-worldbook'(element, ctx) {
      const entry = await storage.worldbook.get(element.dataset.worldbookId);
      if (!entry) return toast('世界书条目不存在。', { type: 'error' });
      openWorldbookEditor(entry, ctx);
    },

    async 'delete-worldbook'(element, ctx) {
      const entry = await storage.worldbook.get(element.dataset.worldbookId);
      if (!entry) return;
      const ok = await confirmDialog({
        eyebrow: '删除世界书条目',
        title: `删除「${entry.title}」？`,
        message: '删除后 KP 将无法再检索到这条记录。该操作无法撤销。',
        confirmLabel: '删除条目',
        danger: true,
      });
      if (!ok) return;
      await storage.worldbook.remove(entry.id);
      toast('世界书条目已删除。', { type: 'success' });
      ctx.refresh();
    },

    async 'export-worldbook'() {
      const entries = await storage.worldbook.list();
      if (!entries.length) return toast('世界书还是空的。', { type: 'info' });
      const markdown = [
        '# Cthulhu Table 世界书',
        '',
        ...entries.map(
          (entry) =>
            `## ${entry.title}\n\n- 类型：${TYPE_LABELS[entry.type] || entry.type}\n- 模组：${
              entry.moduleTitle || '未绑定'
            }\n- 时间：${formatDateTime(entry.createdAt)}\n\n${entry.content}\n`
        ),
      ].join('\n');
      downloadFile(
        `${sanitizeFilename('cthulhu-table-worldbook', 'worldbook')}.md`,
        markdown,
        'text/markdown;charset=utf-8'
      );
      toast('世界书 Markdown 已导出。', { type: 'success' });
    },
  },
};

function openWorldbookEditor(entry, ctx) {
  const current = entry || {
    type: 'note',
    title: '',
    content: '',
    tags: [],
    importance: 2,
    includeInContext: true,
  };
  const body = document.createElement('div');
  body.innerHTML = `<div class="form-grid">
    <label class="form-field form-field--wide"><span class="form-field__label">标题</span><input class="form-input" id="wb-title" value="${escapeHTML(
      current.title || ''
    )}" placeholder="例如：圣玛丽医院旧楼"></label>
    <label class="form-field"><span class="form-field__label">类型</span><select class="form-input" id="wb-type">${Object.entries(
      TYPE_LABELS
    )
      .map(
        ([value, label]) =>
          `<option value="${value}" ${current.type === value ? 'selected' : ''}>${label}</option>`
      )
      .join('')}</select></label>
    <label class="form-field"><span class="form-field__label">重要度 0–5</span><input class="form-input" id="wb-importance" type="number" min="0" max="5" value="${
      current.importance ?? 2
    }"></label>
    <label class="form-field form-field--wide"><span class="form-field__label">正文</span><textarea class="form-input form-textarea" id="wb-content" rows="12" placeholder="可以写地点、NPC、线索、世界设定……">${escapeHTML(
      current.content || ''
    )}</textarea></label>
    <label class="form-field form-field--wide"><span class="form-field__label">标签（逗号分隔）</span><input class="form-input" id="wb-tags" value="${escapeHTML(
      (current.tags || []).join('、')
    )}"></label>
    <label class="check-line form-field--wide"><input type="checkbox" id="wb-context" ${
      current.includeInContext !== false ? 'checked' : ''
    }> 允许 KP 检索并写入上下文</label>
  </div>`;
  openModal({
    eyebrow: 'World Book',
    title: entry ? '编辑世界书条目' : '新建世界书条目',
    body,
    footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>取消</button><button class="btn btn--primary" type="button" data-save-worldbook>${icon(
      'check'
    )} 保存</button></div>`,
    onMount: (dialog) => {
      dialog.querySelector('[data-save-worldbook]')?.addEventListener('click', async () => {
        const title = dialog.querySelector('#wb-title')?.value?.trim();
        if (!title) return toast('标题不能为空。', { type: 'error' });
        const tags = String(dialog.querySelector('#wb-tags')?.value || '')
          .split(/[、,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean);
        await storage.worldbook.save({
          ...current,
          type: dialog.querySelector('#wb-type')?.value || 'note',
          title,
          content: dialog.querySelector('#wb-content')?.value || '',
          tags,
          importance: Number(dialog.querySelector('#wb-importance')?.value) || 0,
          includeInContext: Boolean(dialog.querySelector('#wb-context')?.checked),
          source: entry?.source || 'manual',
        });
        closeModal();
        toast('世界书条目已保存。', { type: 'success' });
        ctx.refresh();
      });
    },
  });
}

export default worldbookView;
