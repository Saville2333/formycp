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
  parseRolesFromText,
} from '../module.js';
import { createInitialKpState } from '../kp.js';
import { auditModuleWithAI } from '../module-audit.js';
import {
  editModuleWithAI,
  requestedHOCodes,
  MAX_EDIT_CHARS,
} from '../module-editor.js';
import {
  escapeHTML,
  icon,
  getInitials,
  formatDate,
  downloadFile,
  sanitizeFilename,
  toast,
  openModal,
  closeModal,
  confirmDialog,
} from '../ui.js';

function moduleRolesMarkup(module) {
  const roles = module.roles || [];
  if (!roles.length) return '';
  return `<div class="module-roles">
    <p class="module-audit__title">${icon('users')} HO 身份位</p>
    <div class="module-role-list">${roles
      .map(
        (role) => `<article class="module-role">
          <div class="module-role__head"><span class="tag tag--gold">${escapeHTML(
            role.code
          )}</span><strong>${escapeHTML(role.title)}</strong></div>
          <p class="module-role__public">${escapeHTML(role.publicInfo || role.summary || '无公开信息')}</p>
          ${
            role.privateInfo
              ? `<details class="module-role__secret"><summary>私密信息</summary><pre>${escapeHTML(
                  role.privateInfo
                )}</pre></details>`
              : ''
          }
          ${role.goals?.length ? `<p class="module-role__goals">目标：${role.goals.map((goal) => escapeHTML(goal)).join('；')}</p>` : ''}
        </article>`
      )
      .join('')}</div>
  </div>`;
}

function moduleAuditMarkup(module) {
  const audit = module.aiAudit;
  if (!audit) {
    return `<div class="module-audit is-empty">
      <p class="module-audit__title">${icon('search')} 尚未进行 AI 结构检测</p>
      <p class="module-audit__text">可以使用 DeepSeek / OpenAI 兼容接口检查切分、关键线索与必须触发事件。AI 只给建议，不会改动原文。</p>
    </div>`;
  }
  return `<div class="module-audit">
    <div class="module-audit__head">
      <span class="module-audit__title">${icon('spark')} AI 结构检测</span>
      <span class="tag ${audit.verdict === 'ok' ? 'tag--pc' : 'tag--npc'}">${escapeHTML(
        audit.verdict || 'warning'
      )}</span>
      <span class="panel__meta">${escapeHTML(audit.model || '')}</span>
    </div>
    <p class="module-audit__summary">${escapeHTML(audit.summary || '无摘要')}</p>
    ${
      audit.warnings?.length
        ? `<ul class="module-audit__warnings">${audit.warnings
            .slice(0, 8)
            .map(
              (warning) =>
                `<li><span class="tag">${escapeHTML(warning.code || 'other')}</span> ${escapeHTML(
                  warning.message
                )}${warning.sceneTitle ? `<small>场景：${escapeHTML(warning.sceneTitle)}</small>` : ''}</li>`
            )
            .join('')}</ul>`
        : '<p class="module-audit__text">没有发现明显结构问题。</p>'
    }
    ${
      audit.sceneIssues?.length
        ? `<details class="module-audit__details"><summary>切分建议（${audit.sceneIssues.length}）</summary><ul>${audit.sceneIssues
            .map(
              (item) =>
                `<li><strong>${escapeHTML(item.title)}</strong>：${escapeHTML(item.issue)}${
                  item.suggestion ? ` → ${escapeHTML(item.suggestion)}` : ''
                }</li>`
            )
            .join('')}</ul></details>`
        : ''
    }
    <p class="module-audit__foot">${escapeHTML(
      `已标记 ${audit.keyClues?.length || 0} 条关键线索、${audit.mustTriggerEvents?.length || 0} 个必须事件 · ${new Date(
        audit.checkedAt
      ).toLocaleString('zh-CN')}`
    )}${audit.truncated ? ' · 正文过长，仅检测了前一部分' : ''}</p>
  </div>`;
}

function openModuleStudio({ text, fileName = '', title = '' }, ctx) {
  let originalText = text;
  let currentText = text;
  let parsed = null;
  let undoStack = [];
  let dirty = false;
  let saved = false;
  try {
    parsed = parseModuleFile({ text: currentText, fileName, title });
  } catch (error) {
    toast(error.message, { type: 'error', duration: 7000 });
    return;
  }
  const initialTitle = String(title || parsed.title || '');
  const body = document.createElement('div');
  body.className = 'module-studio';
  body.innerHTML = `<div class="module-studio__bar">
    <label class="form-field module-studio__title"><span class="form-field__label">模组标题</span><input class="form-input" id="studio-title" value="${escapeHTML(
      initialTitle
    )}"></label>
    <div class="module-studio__stats" id="studio-stats"></div>
    <div class="module-studio__actions">
      <button class="btn btn--ghost btn--sm" type="button" data-studio-undo disabled>撤销 AI</button>
      <button class="btn btn--ghost btn--sm" type="button" data-studio-reparse>重新解析</button>
      <button class="btn btn--ghost btn--sm" type="button" data-studio-restore>恢复原文</button>
    </div>
  </div>
  <div class="module-studio__grid">
    <section class="module-studio__pane module-studio__pane--source">
      <div class="module-studio__pane-head">
        <span>${icon('book')} 模组原文 · 可阅读 / 直接编辑</span>
        <span class="module-studio__count" id="studio-count">${currentText.length} 字</span>
      </div>
      <textarea class="module-studio__source" id="studio-source" spellcheck="false" aria-label="模组原文">${escapeHTML(
        currentText
      )}</textarea>
      <p class="module-studio__hint">左侧是完整原文；可直接修改，或让右侧 KP 按你的要求改。AI 修改会重新解析章节、场景、线索、HO 与检索索引。</p>
    </section>
    <aside class="module-studio__pane module-studio__pane--chat">
      <div class="module-studio__pane-head">
        <span>${icon('spark')} 与 AI KP 对话校订</span>
        <span class="panel__meta">MAX ${MAX_EDIT_CHARS} 字</span>
      </div>
      <div class="module-studio__chat" id="studio-chat">
        <div class="studio-chat__note">${icon(
          'spark'
        )}<p>告诉 KP 要改什么。例如：“把场景二拆成两个场景”“给 HO1 补一段秘密”“把所有‘调查员’改成‘访客’”“把结局写得更克制”。</p></div>
      </div>
      <div class="module-studio__composer">
        <textarea class="form-input form-textarea" id="studio-request" rows="4" placeholder="描述你想怎么改这份模组……"></textarea>
        <div class="module-studio__composer-actions">
          <span class="form-help">AI 只改左侧正文；保存前不会写入档案柜。</span>
          <button class="btn btn--gold btn--sm" type="button" data-studio-ai>${icon(
            'spark'
          )} 发送给 KP</button>
        </div>
      </div>
    </aside>
  </div>`;
  openModal({
    eyebrow: 'Module Studio',
    title: '阅读模组 · 与 KP 一起校订',
    body,
    footer: `<div class="module-studio__footer">
      <span class="module-studio__footer-note">${icon(
        'alert'
      )} 保存前，档案柜和原始模组不会改变。</span>
      <div class="modal-actions">
        <button class="btn btn--ghost" type="button" data-studio-cancel>退回不保存</button>
        <button class="btn btn--primary" type="button" data-studio-save>${icon(
          'check'
        )} 保存模组</button>
      </div>
    </div>`,
    onMount: (dialog) => {
      dialog.classList.add('modal--studio');
      const source = dialog.querySelector('#studio-source');
      const count = dialog.querySelector('#studio-count');
      const statsElement = dialog.querySelector('#studio-stats');
      const chat = dialog.querySelector('#studio-chat');
      const requestInput = dialog.querySelector('#studio-request');
      const aiButton = dialog.querySelector('[data-studio-ai]');
      const undoButton = dialog.querySelector('[data-studio-undo]');
      const titleInput = dialog.querySelector('#studio-title');

      const updateStats = (nextParsed = parsed) => {
        parsed = nextParsed;
        const stats = moduleStats(parsed);
        statsElement.innerHTML = `<span><strong>${stats.chapters}</strong> 章</span><span><strong>${
          stats.scenes
        }</strong> 场景</span><span><strong>${stats.clues}</strong> 线索</span><span><strong>${
          stats.npcs
        }</strong> NPC</span><span><strong>${stats.roles || 0}</strong> HO</span><span><strong>${
          stats.chunks
        }</strong> 分块</span>`;
        count.textContent = `${currentText.length} 字`;
        undoButton.disabled = !undoStack.length;
      };

      const syncText = (nextText, { pushUndo = false, markDirty = true } = {}) => {
        const nextParsed = parseModuleFile({
          text: nextText,
          fileName,
          title: titleInput.value.trim() || initialTitle,
        });
        if (pushUndo) undoStack.push(currentText);
        currentText = nextText;
        source.value = currentText;
        if (markDirty) dirty = true;
        updateStats(nextParsed);
      };

      const addChat = (role, content, extraClass = '') => {
        const item = document.createElement('div');
        item.className = `studio-chat__item studio-chat__item--${role} ${extraClass}`.trim();
        item.innerHTML = `<span class="studio-chat__label">${
          role === 'user' ? '你' : role === 'kp' ? 'KP' : '系统'
        }</span><div class="studio-chat__bubble">${escapeHTML(content).replace(/\n/g, '<br>')}</div>`;
        chat.appendChild(item);
        chat.scrollTop = chat.scrollHeight;
        return item;
      };

      const setBusy = (busy) => {
        aiButton.disabled = busy;
        aiButton.classList.toggle('is-busy', busy);
        aiButton.innerHTML = busy
          ? `${icon('spark')} KP 正在修订…`
          : `${icon('spark')} 发送给 KP`;
        requestInput.disabled = busy;
      };

      updateStats(parsed);
      source.addEventListener('input', () => {
        currentText = source.value;
        dirty = true;
        count.textContent = `${currentText.length} 字`;
      });
      titleInput?.addEventListener('input', () => {
        dirty = true;
      });

      dialog.querySelector('[data-studio-reparse]')?.addEventListener('click', () => {
        try {
          syncText(source.value, { pushUndo: false });
          toast('已重新解析结构与统计。', { type: 'success', duration: 2200 });
        } catch (error) {
          toast(error.message, { type: 'error', duration: 6000 });
        }
      });

      dialog.querySelector('[data-studio-restore]')?.addEventListener('click', () => {
        if (!originalText || currentText === originalText) return;
        try {
          undoStack.push(currentText);
          syncText(originalText, { pushUndo: false });
          toast('已恢复为导入时的原文。', { type: 'info' });
        } catch (error) {
          toast(error.message, { type: 'error' });
        }
      });

      undoButton?.addEventListener('click', () => {
        const previous = undoStack.pop();
        if (previous === undefined) return;
        try {
          syncText(previous, { pushUndo: false });
        } catch (error) {
          toast(error.message, { type: 'error' });
        }
      });

      const sendToKp = async () => {
        const request = String(requestInput.value || '').trim();
        if (!request) return toast('请先写下修改要求。', { type: 'warning' });
        const profile = storage.settings.getActiveApiProfile();
        if (!profile) {
          return toast('尚未配置 AI 接口，无法与 KP 对话。', { type: 'error', duration: 6000 });
        }
        if (source.value.length > MAX_EDIT_CHARS) {
          return toast(
            `当前模组约 ${source.value.length} 字，超过单次 AI 校订上限 ${MAX_EDIT_CHARS} 字；请直接编辑左侧原文。`,
            { type: 'error', duration: 7000 }
          );
        }
        addChat('user', request);
        requestInput.value = '';
        setBusy(true);
        const progress = addChat('system', 'KP 正在阅读全文并准备修订，长模组可能需要一会儿……');
        try {
          const titleForEdit = titleInput.value.trim() || initialTitle;
          const result = await editModuleWithAI({
            profile,
            text: source.value,
            title: titleForEdit,
            request,
          });
          let finalText = result.text;
          let finalParsed = parseModuleFile({
            text: finalText,
            fileName,
            title: titleForEdit,
          });
          const requestedCodes = requestedHOCodes(request);
          const missingCodes = () => {
            const present = new Set(
              (finalParsed.roles || []).map((role) =>
                String(role.code || '').replace(/\s+/g, '').toUpperCase()
              )
            );
            return requestedCodes.filter((code) => !present.has(code));
          };
          const hasNoRoles = !(finalParsed.roles || []).length;
          const mentionedRoles =
            requestedCodes.length > 0 || /HO|身份|角色分配|将死之人|长生之人/i.test(request);
          if ((requestedCodes.length && missingCodes().length) || (hasNoRoles && mentionedRoles)) {
            addChat(
              'system',
              '本轮修订没有检测到完整的 HO 身份，正在让 KP 重新扫描全文并补全 HO 段落……'
            );
            try {
              const repairRequest = `${request}\n\n【HO 补全要求】当前正文没有检测到${requestedCodes.length ? ` ${requestedCodes.join('、')} ` : ' HO 身份'}。请重新扫描全文和上面的要求，保留其他内容，补出 # 角色 下的 HO 标题，并写全“公开信息/秘密/人设/目标/结局”。必须把 HO 写进返回的完整正文，不能只在对话里说明。`;
              const repaired = await editModuleWithAI({
                profile,
                text: finalText,
                title: titleForEdit,
                request: repairRequest,
              });
              const repairedParsed = parseModuleFile({
                text: repaired.text,
                fileName,
                title: titleForEdit,
              });
              const repairedCodes = new Set(
                (repairedParsed.roles || []).map((role) =>
                  String(role.code || '').replace(/\s+/g, '').toUpperCase()
                )
              );
              const stillMissing = requestedCodes.filter((code) => !repairedCodes.has(code));
              if (
                (repairedParsed.roles || []).length > (finalParsed.roles || []).length ||
                stillMissing.length < missingCodes().length
              ) {
                finalText = repaired.text;
                finalParsed = repairedParsed;
              }
            } catch (repairError) {
              addChat(
                'system',
                `HO 补全尝试未成功：${repairError.message}。当前采用第一次修订结果。`,
                'studio-chat__item--error'
              );
            }
          }
          undoStack.push(source.value);
          currentText = finalText;
          source.value = currentText;
          dirty = true;
          if (titleInput.value.trim() === initialTitle && finalParsed.title) {
            titleInput.value = finalParsed.title;
          }
          updateStats(finalParsed);
          progress.remove();
          const finalStats = moduleStats(finalParsed);
          const missingAfter = missingCodes();
          addChat(
            'kp',
            `已按你的要求修订正文，并重新解析为 ${finalStats.chapters} 章 / ${
              finalStats.scenes
            } 场景 / ${finalStats.roles || 0} 个 HO。${
              missingAfter.length
                ? `仍未检测到 ${missingAfter.join('、')}，请检查 HO 标题是否完整。`
                : finalStats.roles
                  ? 'HO 已写入正文。'
                  : ''
            }确认后点击「保存模组」；如果改坏了，可以撤销或恢复原文。`
          );
        } catch (error) {
          progress.remove();
          addChat('system', error.message, 'studio-chat__item--error');
        } finally {
          setBusy(false);
        }
      };

      aiButton?.addEventListener('click', sendToKp);
      requestInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          sendToKp();
        }
      });

      dialog.querySelector('[data-studio-cancel]')?.addEventListener('click', () => {
        closeModal();
        toast(dirty ? '已退回，未保存本次校订。' : '已关闭模组校订。', {
          type: 'info',
        });
      });

      dialog.querySelector('[data-studio-save]')?.addEventListener('click', async () => {
        const button = dialog.querySelector('[data-studio-save]');
        button.disabled = true;
        button.textContent = '保存中…';
        try {
          const finalTitle = titleInput.value.trim();
          const finalModule = parseModuleFile({
            text: source.value,
            fileName,
            title: finalTitle,
          });
          const savedModule = await storage.modules.save(finalModule);
          saved = true;
          closeModal();
          toast(`《${savedModule.title}》已保存：${savedModule.chunks.length} 个分块。`, {
            type: 'success',
            duration: 5000,
          });
          ctx.refresh();
          ctx.navigate('#/modules');
        } catch (error) {
          toast(error.message, { type: 'error', duration: 7000 });
          button.disabled = false;
          button.innerHTML = `${icon('check')} 保存模组`;
        }
      });
    },
    onClose: () => {
      const dialog = document.getElementById('app-dialog');
      dialog?.classList.remove('modal--studio');
    },
  });
}

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
  const audit = module.aiAudit;
  return `<article class="module-card">
    <div class="module-card__top">
      <div class="module-card__glyph">${icon('book')}</div>
      <div class="module-card__id">
        <h2 class="module-card__title">${escapeHTML(module.title)}</h2>
        <p class="module-card__meta">${escapeHTML(
          `${stats.chapters} 章 · ${stats.scenes} 场景 · ${stats.clues} 线索 · ${stats.npcs} NPC · ${stats.roles || 0} HO · ${stats.chunks} 分块`
        )}</p>
      </div>
      <div class="module-card__badges">
        ${isActive ? '<span class="tag tag--pc">进行中</span>' : ''}
        ${
          audit
            ? `<span class="tag ${audit.verdict === 'ok' ? 'tag--pc' : 'tag--npc'}" title="${escapeHTML(
                audit.summary || ''
              )}">AI ${audit.verdict === 'ok' ? '通过' : `${(audit.warnings || []).length} 提示`}</span>`
            : ''
        }
      </div>
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
      const settings = storage.settings.get();
      const profiles = settings.api.profiles || [];
      const defaultCheckId =
        settings.api.moduleCheckProfileId || settings.api.activeProfileId || profiles[0]?.id || '';
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
        <div class="settings-subsection">
          <h4 class="settings-subsection__title">${icon('search')} AI 结构检测（可选）</h4>
          <label class="check-line"><input type="checkbox" id="module-ai-enabled" ${
            profiles.length ? 'checked' : 'disabled'
          }> 导入后调用 AI 审校结构，标记关键线索 / 事件并给出切分提示</label>
          <p class="form-help">推荐使用 DeepSeek 官方接口：<code>https://api.deepseek.com/v1</code>，模型 <code>deepseek-chat</code>。检测只读取模组文本，不会改写原文。</p>
          <div class="form-grid" style="margin-top:10px;">
            <label class="form-field form-field--wide"><span class="form-field__label">检测接口</span>
              <select class="form-input" id="module-ai-profile" ${profiles.length ? '' : 'disabled'}>
                ${
                  profiles.length
                    ? profiles
                        .map(
                          (profile) =>
                            `<option value="${escapeHTML(profile.id)}" ${
                              profile.id === defaultCheckId ? 'selected' : ''
                            }>${escapeHTML(profile.name)} · ${escapeHTML(profile.model || '未填写模型')}</option>`
                        )
                        .join('')
                    : '<option value="">未配置接口</option>'
                }
              </select>
            </label>
          </div>
          <p class="module-import-status" id="module-import-status"></p>
        </div>
        <div class="info-strip">
          ${icon('file')}
          <span>支持 .txt / .md / .json。JSON 可以是 Cthulhu Table 模组结构，也可以是普通文本对象。检测失败不会阻止本地导入。</span>
        </div>`;
      openModal({
        eyebrow: 'Module Import',
        title: '导入模组',
        body,
        footer: `<div class="modal-actions">
          <button class="btn btn--ghost" type="button" data-close-dialog>取消</button>
          <button class="btn btn--ghost" type="button" data-module-import-submit>${icon(
            'upload'
          )} 快速保存</button>
          <button class="btn btn--primary" type="button" data-module-studio>${icon(
            'book'
          )} 阅读 / AI 校订</button>
        </div>`,
        onMount: (dialog) => {
          let fileName = '';
          const fileInput = dialog.querySelector('#module-import-file');
          const textArea = dialog.querySelector('#module-import-text');
          const titleInput = dialog.querySelector('#module-import-title');
          const status = dialog.querySelector('#module-import-status');
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
          dialog.querySelector('[data-module-studio]')?.addEventListener('click', () => {
            const text = textArea.value;
            if (!text.trim()) return toast('请先选择文件或粘贴文本。', { type: 'error' });
            try {
              parseModuleFile({ text, fileName, title: titleInput.value.trim() });
            } catch (error) {
              return toast(error.message, { type: 'error', duration: 7000 });
            }
            const studioTitle = titleInput.value.trim();
            closeModal();
            openModuleStudio({ text, fileName, title: studioTitle }, ctx);
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
              const checkEnabled = Boolean(dialog.querySelector('#module-ai-enabled')?.checked);
              const checkProfileId = dialog.querySelector('#module-ai-profile')?.value || '';
              const checkProfile =
                profiles.find((profile) => profile.id === checkProfileId) ||
                profiles.find((profile) => profile.id === settings.api.activeProfileId) ||
                profiles[0];
              let auditResult = null;
              let auditError = '';
              if (checkEnabled && checkProfile) {
                button.textContent = 'AI 检测中…';
                if (status) status.textContent = '正在调用接口审校模组结构…';
                try {
                  auditResult = await auditModuleWithAI(parsed, checkProfile, {
                    onStatus: (message) => {
                      if (status) status.textContent = message;
                    },
                  });
                  if (status) {
                    status.textContent = `检测完成：${auditResult.audit.verdict} · ${
                      auditResult.audit.summary || '无摘要'
                    }${auditResult.truncated ? '（正文过长，仅检测了前一部分）' : ''}`;
                  }
                } catch (error) {
                  auditError = error.message;
                  if (status) status.textContent = `AI 检测失败：${error.message}`;
                  toast(`AI 检测失败，仍会保存本地解析结果：${error.message}`, {
                    type: 'warning',
                    duration: 7000,
                  });
                }
              }
              button.textContent = '保存中…';
              const saved = await storage.modules.save(parsed);
              const auditText = auditResult
                ? ` AI 检测：${auditResult.audit.verdict}，${(auditResult.audit.warnings || []).length} 条提示。`
                : auditError
                  ? ' AI 检测失败，可在结构页重试。'
                  : '';
              toast(`《${saved.title}》已导入：${saved.chunks.length} 个分块。${auditText}`, {
                type: auditError ? 'info' : 'success',
                duration: 6000,
              });
              closeModal();
              ctx.refresh();
            } catch (error) {
              toast(error.message, { type: 'error', duration: 7000 });
              button.disabled = false;
              button.innerHTML = `${icon('upload')} 快速保存`;
            }
          });
        },
      });
    },

    async 'view-module'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return toast('模组不存在。', { type: 'error' });
      const stats = moduleStats(module);
      const rolesForView =
        module.roles?.length || !module.source?.rawText
          ? module.roles || []
          : parseRolesFromText(module.source.rawText);
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
        <p class="modal-copy">${stats.chapters} 章 · ${stats.scenes} 场景 · ${stats.clues} 线索 · ${stats.npcs} NPC · ${stats.events} 事件 · ${rolesForView.length} HO · ${stats.chunks} 分块</p>
      </div>
      ${moduleAuditMarkup(module)}
      ${moduleRolesMarkup({ ...module, roles: rolesForView })}
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
        <button class="btn btn--gold" type="button" data-action="audit-module" data-module-id="${escapeHTML(
          module.id
        )}">${icon('search')} AI 重新检测</button>
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

    async 'audit-module'(element, ctx) {
      const module = await storage.modules.get(element.dataset.moduleId);
      if (!module) return toast('模组不存在。', { type: 'error' });
      const settings = storage.settings.get();
      const profile =
        settings.api.profiles.find(
          (item) => item.id === settings.api.moduleCheckProfileId
        ) ||
        settings.api.profiles.find((item) => item.id === settings.api.activeProfileId) ||
        settings.api.profiles[0];
      if (!profile) {
        return toast('请先在「设置与接口」添加 DeepSeek 或 OpenAI 兼容接口。', {
          type: 'error',
          duration: 6000,
        });
      }
      const body = document.createElement('div');
      body.innerHTML = `<p class="modal-copy">将使用 <strong>${escapeHTML(
        profile.name
      )} / ${escapeHTML(profile.model || '未填写模型')}</strong> 审校结构。检测只读取模组文本，不会改动原文；建议先导出模组 JSON 备份。</p><p class="module-import-status" id="audit-progress">等待开始…</p>`;
      openModal({
        eyebrow: 'AI Module Audit',
        title: '模组 AI 结构检测',
        body,
        footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-close-dialog>关闭</button></div>`,
      });
      const progress = document.getElementById('audit-progress');
      try {
        const result = await auditModuleWithAI(module, profile, {
          onStatus: (message) => {
            if (progress) progress.textContent = message;
          },
        });
        await storage.modules.save(module);
        if (progress) progress.textContent = '检测完成，正在刷新档案柜…';
        closeModal();
        toast(
          `AI 检测完成：${result.audit.verdict}，${result.ignored.length} 条无法匹配的建议已忽略。`,
          { type: result.audit.verdict === 'ok' ? 'success' : 'info', duration: 5500 }
        );
        ctx.refresh();
      } catch (error) {
        if (progress) progress.textContent = `检测失败：${error.message}`;
        toast(`AI 检测失败：${error.message}`, { type: 'error', duration: 7000 });
      }
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
      let roles = (module.roles || []).filter((role) => role.title);
      if (!roles.length && module.source?.rawText) {
        roles = parseRolesFromText(module.source.rawText);
      }
      const defaultAssignments = roles.map((role, index) => characters[index]?.id || '');
      const body = document.createElement('div');
      body.innerHTML = `<p class="modal-copy">选择你亲自扮演的调查员。其余调查员由 AI 扮演，你可以随时让他们行动。模组识别到 <strong>${
        roles.length
      }</strong> 个 HO 身份位。</p>
      <div class="settings-subsection">
        <h4 class="settings-subsection__title">${icon('users')} 你扮演谁？</h4>
        <div class="pov-choice-list">
          ${characters
            .map(
              (character, index) => `<label class="pov-choice">
                <input type="radio" name="campaign-pov" value="${escapeHTML(character.id)}" ${
                  index === 0 ? 'checked' : ''
                }>
                <span class="pov-choice__avatar">${escapeHTML(getInitials(character.name))}</span>
                <span class="pov-choice__body"><strong>${escapeHTML(character.name)}</strong><small>${escapeHTML(
                  character.occupation || '调查员'
                )} · ${escapeHTML(character.age || '?')} 岁</small></span>
                <span class="tag">可选</span>
              </label>`
            )
            .join('')}
        </div>
      </div>
      ${
        roles.length
          ? `<div class="settings-subsection">
              <h4 class="settings-subsection__title">${icon('scroll')} HO 身份分配</h4>
              <p class="form-help">每个 HO 只能分配给一位调查员。你的角色必须分配一个身份；其他身份交给 AI 调查员。私密信息只会进入对应角色与 AI 的上下文，不会显示在你的界面上。</p>
              <div class="role-assignment-list">
                ${roles
                  .map(
                    (role, index) => `<div class="role-assignment">
                      <div class="role-assignment__info">
                        <span class="tag tag--gold">${escapeHTML(role.code)}</span>
                        <strong>${escapeHTML(role.title)}</strong>
                        <p>${escapeHTML(role.summary || role.publicInfo || '无公开身份说明')}</p>
                      </div>
                      <select class="form-input" data-role-assign="${escapeHTML(role.id)}" aria-label="${escapeHTML(
                        `${role.code} ${role.title} 分配给谁`
                      )}">
                        <option value="">不分配</option>
                        ${characters
                          .map(
                            (character) =>
                              `<option value="${escapeHTML(character.id)}" ${
                                defaultAssignments[index] === character.id ? 'selected' : ''
                              }>${escapeHTML(character.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </div>`
                  )
                  .join('')}
              </div>
              ${
                roles.length > characters.length
                  ? `<p class="form-help form-help--danger">HO 数量多于调查员；未分配的身份不会进入本场战役。</p>`
                  : ''
              }
            </div>`
          : `<div class="info-strip">${icon(
              'alert'
            )}<span>这份模组没有识别到 HO 身份位。本场将直接使用调查员原有详细设定；你仍然可以选择自己扮演的角色。</span></div>`
      }
      <div class="info-strip">${icon('key')}<span>开始后，KP 会自动开场第一幕。你的私密信息只会出现在「你的身份」面板；AI 角色的私密信息不会写入你的界面或公开日志。</span></div>`;
      openModal({
        eyebrow: 'Campaign Setup',
        title: '选择视角与身份',
        body,
        footer: `<div class="modal-actions">
          <button class="btn btn--ghost" type="button" data-close-dialog>取消</button>
          <button class="btn btn--primary" type="button" data-start-campaign>${icon(
            'arrow-right'
          )} 开始战役</button>
        </div>`,
        onMount: (dialog) => {
          dialog.querySelector('[data-start-campaign]')?.addEventListener('click', () => {
            const povCharacterId = dialog.querySelector('input[name="campaign-pov"]:checked')?.value;
            if (!povCharacterId) return toast('请选择你扮演的调查员。', { type: 'error' });
            const assignments = [];
            const usedCharacters = new Set();
            for (const role of roles) {
              const select = [...dialog.querySelectorAll('[data-role-assign]')].find(
                (element) => element.dataset.roleAssign === role.id
              );
              const characterId = select?.value || '';
              if (!characterId) continue;
              if (usedCharacters.has(characterId)) {
                return toast('一位调查员不能同时分配到两个 HO 身份。', { type: 'error' });
              }
              usedCharacters.add(characterId);
              assignments.push({
                roleId: role.id,
                characterId,
                code: role.code,
                title: role.title,
                summary: role.summary || '',
                publicInfo: role.publicInfo || '',
                privateInfo: role.privateInfo || '',
                persona: role.persona || '',
                goals: role.goals || [],
                ending: role.ending || '',
              });
            }
            if (roles.length && !assignments.some((assignment) => assignment.characterId === povCharacterId)) {
              return toast('请先为你要扮演的调查员分配一个 HO 身份。', { type: 'error' });
            }
            const privateNotes = assignments
              .filter((assignment) => assignment.privateInfo)
              .map((assignment) => ({
                characterId: assignment.characterId,
                roleId: assignment.roleId,
                title: `${assignment.code} ${assignment.title} · 私密信息`,
                content: assignment.privateInfo,
                source: 'role',
              }));
            const campaign = storage.campaigns.save({
              title: module.title,
              status: 'active',
              moduleId: module.id,
              moduleTitle: module.title,
              playerCharacterIds: characters.map((character) => character.id),
              povCharacterId,
              roleAssignments: assignments,
              privateNotes,
              openingPending: true,
              memoryChoice: '',
              ending: null,
              npcIds: (module.npcs || []).map((npc) => npc.id),
              kpState: createInitialKpState(module),
              settings: storage.settings.get().kp,
              lastPlayedAt: new Date().toISOString(),
            });
            storage.campaigns.setActive(campaign.id);
            toast(`战役《${campaign.title}》已开始；KP 正在开场。`, {
              type: 'success',
              duration: 4500,
            });
            closeModal();
            ctx.navigate('#/table');
          });
        },
      });
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
