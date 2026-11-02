/**
 * module-view.js — 模组档案柜、导入与结构检查
 */

import { storage } from '../storage.js';
import {
  parseModuleFile,
  buildRetrievalIndex,
  rebuildChunks,
  moduleStats,
  moduleToMarkdown,
  flattenScenes,
  findScene,
  toggleKeyClue,
  setEventMustTrigger,
} from '../module.js';
import { createInitialKpState } from '../kp.js';
import {
  escapeHTML,
  icon,
  formatDate,
  downloadFile,
  sanitizeFilename,
  toast,
  openModal,
  closeModal,
  confirmDialog,
} from '../ui.js';

function pageHead(actions = '') {
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">Module Archive</p>
      <h1 class="page-title">模组档案</h1>
      <p class="page-lede">
        导入原文后切分章节、场景、线索与 NPC。检索只返回原文分块；未解锁内容不会进入守秘人的提示词。
      </p>
    </div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
  </header>`;
}

function moduleCard(module, activeCampaign) {
  const stats = moduleStats(module);
  const isActive = activeCampaign?.moduleId === module.id;
  return `<article class="module-card">
    <div class="module-card__top">
      <div class="module-card__glyph">${icon('book')}</div>
      <div class="module-card__id">
        <h2 class="module-card__title">${escapeHTML(module.title)}</h2>
        <p class="module-card__meta">${escapeHTML(
          `${stats.chapters} 章 · ${stats.scenes} 场景 · ${stats.clues} 线索 · ${stats.npcs} NPC · ${stats.chunks} 分块`
        )}</p>
      </div>
      ${isActive ? '<span class="tag tag--pc">进行中</span>' : ''}
    </div>
    <p class="module-card__desc">${escapeHTML(
      module.description || module.structure?.chapters?.[0]?.summary || '尚无简介。'
    )}</p>
    <div class="module-card__stats">
      <span><strong>${stats.events}</strong> 事件</span>
      <span><strong>${stats.keywords}</strong> 检索词</span>
      <span>${escapeHTML(formatDate(module.updatedAt))}</span>
    </div>
    <div class="module-card__actions">
      <button class="btn btn--primary btn--sm" type="button" data-action="start-campaign" data-module-id="${escapeHTML(
        module.id
      )}">${icon('table')} ${isActive ? '继续战役' : '开始战役'}</button>
      <button class="btn btn--ghost btn--sm" type="button" data-action="view-module" data-module-id="${escapeHTML(
        module.id
      )}">${icon('eye')} 结构</button>
      <button class="btn btn--ghost btn--sm" type="button" data-action="export-module" data-module-id="${escapeHTML(
        module.id
      )}">${icon('download')} 导出</button>
      <button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-module" data-module-id="${escapeHTML(
        module.id
      )}" title="删除模组" aria-label="删除 ${escapeHTML(module.title)}">${icon('trash', 'icon--sm')}</button>
    </div>
  </article>`;
}

export const moduleView = {
  async render() {
    const [modules, characters] = await Promise.all([
      storage.modules.list().catch(() => []),
      Promise.resolve(storage.characters.list({ kind: 'pc' })),
    ]);
    const active = storage.campaigns.getActive();
    const listMarkup = modules.length
      ? `<div class="module-list">${modules.map((module) => moduleCard(module, active)).join('')}</div>`
      : `<div class="empty-state">
          <img class="empty-state__sigil" src="assets/sigil.svg" alt="">
          <h2 class="empty-state__title">档案柜仍是空的</h2>
          <p class="empty-state__text">导入 .txt / .md / .json，或直接粘贴文本。系统会按标题层级切分，并保留完整原文。</p>
          <div class="empty-state__actions">
            <button class="btn btn--primary" type="button" data-action="open-module-import">${icon(
              'upload'
            )} 导入第一份模组</button>
          </div>
        </div>`;

    return `
      ${pageHead(
        `<button class="btn btn--primary" type="button" data-action="open-module-import">${icon(
          'upload'
        )} 导入模组</button><span class="stage-badge"><span class="stage-badge__dot"></span>${modules.length} 份档案</span>`
      )}

      <div class="module-page-grid">
        <div>
          <div class="section-head">
            <h2 class="section-head__title">档案柜</h2>
            <span class="panel__meta">${modules.length} MODULES · ${characters.length} PCs</span>
          </div>
          ${listMarkup}
        </div>
        <aside class="settings-stack">
          <section class="panel">
            <div class="panel__head">
              <h2 class="panel__title">${icon('scroll')} 从文本到桌面</h2>
              <span class="panel__meta">PIPELINE</span>
            </div>
            <ol class="pipeline">
              <li class="pipeline__item"><span class="pipeline__num">01</span><div class="pipeline__body"><p class="pipeline__title">结构解析</p><p class="pipeline__text">按 Markdown 标题层级与关键词切分章节、场景、线索、NPC 与事件。</p></div></li>
              <li class="pipeline__item"><span class="pipeline__num">02</span><div class="pipeline__body"><p class="pipeline__title">人工检查</p><p class="pipeline__text">打开「结构」，标记关键线索、必须触发事件，或重建检索分块。</p></div></li>
              <li class="pipeline__item"><span class="pipeline__num">03</span><div class="pipeline__body"><p class="pipeline__title">关键词索引</p><p class="pipeline__text">中文二元词 + 英文单词的倒排索引，按 TF-IDF 与当前场景加权检索。</p></div></li>
              <li class="pipeline__item"><span class="pipeline__num">04</span><div class="pipeline__body"><p class="pipeline__title">进入战役</p><p class="pipeline__text">选择调查员后创建战役，KP 状态机从第一章第一场开始。</p></div></li>
            </ol>
          </section>
          <section class="panel">
            <div class="panel__head">
              <h2 class="panel__title">${icon('shield')} 信息释放</h2>
            </div>
            <p class="modal-copy">
              未解锁章节的分块不会进入提示词。每回合只注入检索到的 2–5 段原文，剩余上下文留给状态、角色摘要与最近对话。
            </p>
            <div class="info-strip" style="margin-top:14px;">
              ${icon('lock')}
              <span>模组原文只写入本机 IndexedDB，不会上传。</span>
            </div>
          </section>
        </aside>
      </div>`;
  },

  actions: {
    async 'open-module-import'(element, ctx) {
      const body = document.createElement('div');
      body.className = 'import-module-form';
      body.innerHTML = `
        <div class="form-grid">
          <label class="form-field">
            <span class="form-field__label">模组标题（可选）</span>
            <input class="form-input" id="module-import-title" placeholder="留空则使用第一个标题">
          </label>
          <label class="form-field">
            <span class="form-field__label">选择文件</span>
            <input class="form-input" type="file" id="module-import-file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json">
          </label>
        </div>
        <label class="form-field">
          <span class="form-field__label">或直接粘贴模组文本</span>
          <textarea class="form-input form-textarea" id="module-import-text" rows="14" placeholder="支持 Markdown 标题层级：# 章节 / ## 场景 / ### 线索：……"></textarea>
        </label>
        <div class="info-strip">
          ${icon('file')}
          <span>支持 .txt / .md / .json。JSON 可以是 Cthulhu Table 模组结构，也可以是普通文本对象。</span>
        </div>`;
      openModal({
        eyebrow: 'Module Import',
        title: '导入模组',
        body,
        footer: `<div class="modal-actions">
          <button class="btn btn--ghost" type="button" data-close-dialog>取消</button>
          <button class="btn btn--primary" type="button" data-module-import-submit>${icon(
            'upload'
          )} 解析并保存</button>
        </div>`,
        onMount: (dialog) => {
          let fileName = '';
          const fileInput = dialog.querySelector('#module-import-file');
          const textArea = dialog.querySelector('#module-import-text');
          const titleInput = dialog.querySelector('#module-import-title');
          fileInput?.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            fileName = file.name;
            try {
              textArea.value = await file.text();
            } catch (error) {
              toast(`读取文件失败：${error.message}`, { type: 'error' });
            }
          });
          dialog.querySelector('[data-module-import-submit]')?.addEventListener('click', async (event) => {
            const button = event.currentTarget;
            const text = textArea.value;
            if (!text.trim()) return toast('请先选择文件或粘贴文本。', { type: 'error' });
            button.disabled = true;
            button.textContent = '解析中…';
            try {
              const parsed = parseModuleFile({
                text,
                fileName,
                title: titleInput.value.trim(),
              });
              const saved = await storage.modules.save(parsed);
              toast(`《${saved.title}》已导入：${saved.chunks.length} 个分块。`, {
                type: 'success',
                duration: 5000,
              });
              closeModal();
              ctx.refresh();
            } catch (error) {
              toast(error.message, { type: 'error', duration: 7000 });
              button.disabled = false;
              button.textContent = '解析并保存';
            }
          });
        },
      });
    },

    async 'view-module'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return toast('模组不存在。', { type: 'error' });
      const stats = moduleStats(module);
      const chapterMarkup = (module.structure?.chapters || [])
        .map(
          (chapter) => `<details class="module-tree__chapter" ${chapter.order === 0 ? 'open' : ''}>
            <summary>${escapeHTML(chapter.title)} <span class="module-tree__count">${chapter.scenes.length} 场景</span></summary>
            <ul class="module-tree__scenes">
              ${chapter.scenes
                .map(
                  (scene) => `<li>
                    <span>${escapeHTML(scene.title)}</span>
                    <span class="module-tree__tags">
                      ${scene.readAloud ? '<span class="tag">朗读</span>' : ''}
                      ${(module.clues || []).filter((clue) => clue.sceneId === scene.id).length ? `<span class="tag">${(module.clues || []).filter((clue) => clue.sceneId === scene.id).length} 线索</span>` : ''}
                      <button class="scene-edit" type="button" data-action="edit-module-scene" data-module-id="${escapeHTML(
                        module.id
                      )}" data-scene-id="${escapeHTML(scene.id)}" title="编辑场景切分">${icon(
                        'edit',
                        'icon--sm'
                      )}</button>
                    </span>
                  </li>`
                )
                .join('')}
            </ul>
          </details>`
        )
        .join('');
      const clues = module.clues || [];
      const events = module.events || [];
      const body = `<div class="module-summary">
        <p class="modal-copy">${stats.chapters} 章 · ${stats.scenes} 场景 · ${stats.clues} 线索 · ${stats.npcs} NPC · ${stats.events} 事件 · ${stats.chunks} 分块</p>
      </div>
      <div class="module-tree">${chapterMarkup || '<p class="modal-copy">尚未生成章节结构。</p>'}</div>
      <div class="sheet-section">
        <h4 class="sheet-section__title">关键线索</h4>
        ${
          clues.length
            ? `<ul class="module-flag-list">${clues
                .map(
                  (clue) => `<li><label><input type="checkbox" data-toggle-clue="${escapeHTML(
                    clue.id
                  )}" ${clue.isKey ? 'checked' : ''}> <span>${escapeHTML(clue.title)}</span></label></li>`
                )
                .join('')}</ul>`
            : '<p class="modal-copy muted">未自动识别到线索。</p>'
        }
      </div>
      <div class="sheet-section">
        <h4 class="sheet-section__title">必须触发的事件</h4>
        ${
          events.length
            ? `<ul class="module-flag-list">${events
                .map(
                  (event) => `<li><label><input type="checkbox" data-toggle-event="${escapeHTML(
                    event.id
                  )}" ${event.mustTrigger ? 'checked' : ''}> <span>${escapeHTML(event.title)}</span></label></li>`
                )
                .join('')}</ul>`
            : '<p class="modal-copy muted">未自动识别到事件标题。</p>'
        }
      </div>
      <div class="info-strip">${icon('refresh')}<span>修改关键标记后，点击「重建检索分块」可以重新生成索引。</span></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn--ghost" type="button" data-action="rebuild-module-index" data-module-id="${escapeHTML(
          module.id
        )}">${icon('refresh')} 重建检索分块</button>
        <button class="btn btn--ghost" type="button" data-action="export-module" data-module-id="${escapeHTML(
          module.id
        )}">${icon('download')} 导出 JSON</button>
      </div>`;
      openModal({
        eyebrow: 'Module Structure',
        title: module.title,
        body,
        footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>关闭</button></div>`,
        onMount: (dialog) => {
          dialog.querySelectorAll('[data-toggle-clue]').forEach((input) => {
            input.addEventListener('change', async () => {
              const fresh = await storage.modules.get(module.id);
              toggleKeyClue(fresh, input.dataset.toggleClue);
              await storage.modules.save(fresh);
              toast('线索标记已更新。', { type: 'info', duration: 2000 });
            });
          });
          dialog.querySelectorAll('[data-toggle-event]').forEach((input) => {
            input.addEventListener('change', async () => {
              const fresh = await storage.modules.get(module.id);
              setEventMustTrigger(fresh, input.dataset.toggleEvent, input.checked);
              await storage.modules.save(fresh);
              toast('事件标记已更新。', { type: 'info', duration: 2000 });
            });
          });
        },
      });
    },

    async 'edit-module-scene'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      const found = findScene(module, element.dataset.sceneId);
      if (!found) return toast('找不到这个场景。', { type: 'error' });
      const { scene } = found;
      const body = document.createElement('div');
      body.innerHTML = `<div class="form-grid">
        <label class="form-field form-field--wide"><span class="form-field__label">场景标题</span><input class="form-input" id="scene-title" value="${escapeHTML(
          scene.title
        )}"></label>
        <label class="form-field form-field--wide"><span class="form-field__label">朗读文本（可选）</span><textarea class="form-input form-textarea" id="scene-readaloud" rows="3">${escapeHTML(
          scene.readAloud || ''
        )}</textarea></label>
        <label class="form-field form-field--wide"><span class="form-field__label">场景正文</span><textarea class="form-input form-textarea" id="scene-content" rows="16">${escapeHTML(
          scene.content || ''
        )}</textarea></label>
      </div>
      <div class="info-strip">${icon('refresh')}<span>保存后会按段落重新生成该模组的分块与关键词索引；线索与事件标记会保留。</span></div>`;
      openModal({
        eyebrow: 'Module Editor',
        title: '修正场景切分',
        body,
        footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>取消</button><button class="btn btn--primary" type="button" data-save-scene>${icon(
          'check'
        )} 保存并重建索引</button></div>`,
        onMount: (dialog) => {
          dialog.querySelector('[data-save-scene]')?.addEventListener('click', async () => {
            const fresh = await storage.modules.get(module.id);
            const target = findScene(fresh, scene.id);
            if (!target) return toast('场景已不存在。', { type: 'error' });
            target.scene.title = dialog.querySelector('#scene-title')?.value?.trim() || target.scene.title;
            target.scene.readAloud = dialog.querySelector('#scene-readaloud')?.value || '';
            target.scene.content = dialog.querySelector('#scene-content')?.value || '';
            target.scene.summary = target.scene.content.slice(0, 180);
            rebuildChunks(fresh);
            await storage.modules.save(fresh);
            closeModal();
            toast('场景已保存，分块与索引已重建。', { type: 'success' });
            ctx.refresh();
          });
        },
      });
    },

    async 'rebuild-module-index'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return;
      buildRetrievalIndex(module);
      rebuildChunks(module);
      await storage.modules.save(module);
      closeModal();
      toast('检索分块与关键词索引已重建。', { type: 'success' });
      ctx.refresh();
    },

    async 'start-campaign'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return toast('模组不存在。', { type: 'error' });
      const existing = storage.campaigns
        .list()
        .find((campaign) => campaign.moduleId === module.id && campaign.status !== 'completed');
      if (existing) {
        storage.campaigns.setActive(existing.id);
        ctx.navigate('#/table');
        return;
      }
      const characters = storage.characters.list({ kind: 'pc' });
      if (!characters.length) {
        const body = `<p class="modal-copy">开始战役至少需要一位调查员。你可以载入示例角色，或先创建自己的调查员。</p>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn--gold" type="button" data-action="load-sample">${icon(
              'spark'
            )} 载入示例</button>
            <a class="btn btn--primary" href="#/builder" data-action="new-character">${icon(
              'wand'
            )} 开始车卡</a>
          </div>`;
        openModal({
          eyebrow: 'Campaign Setup',
          title: '还没有调查员',
          body,
          footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>稍后</button></div>`,
        });
        return;
      }
      const campaign = storage.campaigns.save({
        title: module.title,
        status: 'active',
        moduleId: module.id,
        moduleTitle: module.title,
        playerCharacterIds: characters.map((character) => character.id),
        npcIds: (module.npcs || []).map((npc) => npc.id),
        kpState: createInitialKpState(module),
        settings: storage.settings.get().kp,
        lastPlayedAt: new Date().toISOString(),
      });
      storage.campaigns.setActive(campaign.id);
      toast(`战役《${campaign.title}》已开始。`, { type: 'success' });
      ctx.navigate('#/table');
    },

    async 'export-module'(element) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return;
      downloadFile(`${sanitizeFilename(module.title, 'module')}-模组.json`, JSON.stringify(module, null, 2));
      toast('模组 JSON 已导出。', { type: 'success' });
    },

    async 'delete-module'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return;
      const active = storage.campaigns.getActive();
      const ok = await confirmDialog({
        eyebrow: '删除模组',
        title: `删除《${module.title}》？`,
        message:
          '这会删除模组原文、结构、检索索引与线索；已经创建的战役会保留，但失去模组原文。该操作无法撤销。' +
          (active?.moduleId === module.id ? ' 当前战役正在使用这份模组。' : ''),
        confirmLabel: '删除模组',
        danger: true,
      });
      if (!ok) return;
      await storage.modules.remove(module.id);
      toast('模组已删除。', { type: 'success' });
      ctx.refresh();
    },
  },
};

export default moduleView;
