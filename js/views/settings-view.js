/**
 * settings-view.js — 接口配置、KP 参数、本地存储与日志
 */

import { storage, normalizeApiProfile, normalizeApiPreset } from '../storage.js';
import { api } from '../api.js';
import {
  groupModels,
  formatPrice,
  PRICE_NOTE,
  PROVIDER_META,
} from '../model-catalog.js';
import {
  escapeHTML,
  icon,
  formatBytes,
  formatDateTime,
  formatNumber,
  toast,
  openModal,
  closeModal,
  confirmDialog,
  downloadFile,
} from '../ui.js';

/**
 * 内置服务商快捷预设。只填入 URL / Model，不包含任何密钥；
 * 用户保存到「我的预设」后才会连同 Key 一起留在本地。
 */
const BUILT_IN_PROVIDER_PRESETS = Object.freeze([
  {
    id: 'deepseek',
    provider: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: '推荐用于中文守秘人与模组结构检测',
  },
  {
    id: 'openai',
    provider: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '通用 OpenAI Chat Completions',
  },
  {
    id: 'openrouter',
    provider: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    note: '多模型中转；可能需要在请求头中填写 HTTP-Referer',
  },
  {
    id: 'siliconflow',
    provider: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    note: '国内中转，具体模型名以控制台为准',
  },
]);

function pageHead(actions = '') {
  return `<header class="page-head">
    <div class="page-head__main">
      <p class="page-kicker">Settings & Interface</p>
      <h1 class="page-title">设置与接口</h1>
      <p class="page-lede">
        接口与密钥只保存在当前浏览器，通过前端 fetch 直连你填写的地址。公共设备上请勿保存 API Key。
      </p>
    </div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
  </header>`;
}

function profileCard(profile, activeId) {
  const active = profile.id === activeId;
  const providerLabel = PROVIDER_META[profile.provider]?.label || profile.provider || '自定义';
  return `<article class="api-profile ${active ? 'is-active' : ''}">
    <div class="api-profile__head">
      <div class="api-profile__glyph">${icon('key')}</div>
      <div class="api-profile__id">
        <h3 class="api-profile__name">${escapeHTML(profile.name)} ${active ? '<span class="tag tag--pc">当前</span>' : ''}</h3>
        <p class="api-profile__model">${escapeHTML(profile.model || '未填写模型')} · ${escapeHTML(
          profile.baseUrl
        )}</p>
      </div>
    </div>
    <div class="api-profile__meta">
      <span>${escapeHTML(providerLabel)}</span>
      <span>温度 ${escapeHTML(profile.temperature)}</span>
      <span>Max ${formatNumber(profile.maxTokens)}</span>
      <span>Top P ${escapeHTML(profile.topP)}</span>
      <span>${profile.stream ? '流式' : '非流式'}</span>
      <span>${profile.webSearch?.enabled ? '联网开' : '联网关'}</span>
    </div>
    <div class="api-profile__actions">
      ${
        active
          ? '<span class="tag tag--pc">已启用</span>'
          : `<button class="btn btn--gold btn--sm" type="button" data-action="activate-api" data-profile-id="${escapeHTML(
              profile.id
            )}">启用</button>`
      }
      <button class="btn btn--ghost btn--sm" type="button" data-action="test-api" data-profile-id="${escapeHTML(
        profile.id
      )}">${icon('refresh')} 测试</button>
      <button class="btn btn--ghost btn--sm" type="button" data-action="edit-api" data-profile-id="${escapeHTML(
        profile.id
      )}">${icon('edit')} 编辑</button>
      <button class="btn btn--ghost btn--sm btn--icon" type="button" data-action="delete-api" data-profile-id="${escapeHTML(
        profile.id
      )}" title="删除接口">${icon('trash', 'icon--sm')}</button>
    </div>
  </article>`;
}

function logRow(log) {
  const usage = log.usage
    ? `${formatNumber(log.usage.promptTokens || 0)} + ${formatNumber(log.usage.completionTokens || 0)} tok`
    : '—';
  return `<tr>
    <td>${escapeHTML(log.category || 'chat')}</td>
    <td>${escapeHTML(log.model || '—')}</td>
    <td>${escapeHTML(String(log.durationMs ?? '—'))} ms</td>
    <td>${escapeHTML(usage)}</td>
    <td><span class="status-pill ${log.success ? 'is-ok' : 'is-bad'}">${log.success ? 'OK' : 'ERR'}</span></td>
    <td>${escapeHTML(formatDateTime(log.createdAt))}</td>
    <td class="log-error" title="${escapeHTML(log.error || '')}">${escapeHTML(log.error || '')}</td>
  </tr>`;
}

function providerPresetButtons() {
  return `<div class="provider-presets">
    <span class="provider-presets__label">快捷填入</span>
    ${BUILT_IN_PROVIDER_PRESETS.map(
      (preset) =>
        `<button class="provider-chip" type="button" data-fill-preset="${escapeHTML(
          preset.id
        )}">${escapeHTML(preset.name)}<small>${escapeHTML(preset.model)}</small></button>`
    ).join('')}
  </div>`;
}

function profileForm(profile) {
  return `${providerPresetButtons()}
  <div class="form-grid">
    <label class="form-field"><span class="form-field__label">配置名称</span><input class="form-input" id="api-name" value="${escapeHTML(
      profile.name || ''
    )}" placeholder="例如：DeepSeek 主接口"></label>
    <label class="form-field"><span class="form-field__label">Base URL</span><input class="form-input" id="api-base-url" value="${escapeHTML(
      profile.baseUrl || 'https://api.openai.com/v1'
    )}" placeholder="https://api.openai.com/v1"></label>
    <label class="form-field form-field--wide"><span class="form-field__label">Model</span>
      <span class="model-input-row">
        <input class="form-input" id="api-model" value="${escapeHTML(
          profile.model || ''
        )}" placeholder="gpt-4o-mini / deepseek-chat">
        <button class="btn btn--gold btn--sm" type="button" data-detect-models>${icon(
          'search'
        )} 检测模型</button>
      </span>
    </label>
    <label class="form-field"><span class="form-field__label">API Key</span><input class="form-input" id="api-key" type="password" value="${escapeHTML(
      profile.apiKey || ''
    )}" placeholder="sk-..." autocomplete="off"></label>
    <label class="form-field"><span class="form-field__label">Temperature</span><input class="form-input" id="api-temperature" type="number" min="0" max="2" step="0.1" value="${escapeHTML(
      profile.temperature ?? 0.7
    )}"></label>
    <label class="form-field"><span class="form-field__label">Max Tokens</span><input class="form-input" id="api-max-tokens" type="number" min="1" max="200000" step="1" value="${escapeHTML(
      profile.maxTokens ?? 1600
    )}"></label>
    <label class="form-field"><span class="form-field__label">Top P</span><input class="form-input" id="api-top-p" type="number" min="0" max="1" step="0.05" value="${escapeHTML(
      profile.topP ?? 1
    )}"></label>
    <label class="form-field form-field--check"><span class="form-field__label">流式输出</span><span class="check-line"><input type="checkbox" id="api-stream" ${
      profile.stream !== false ? 'checked' : ''
    }> SSE 逐字渲染</span></label>
  </div>

  <div class="model-picker" id="model-picker" hidden></div>

  <div class="settings-subsection">
    <h4 class="settings-subsection__title">${icon('key')} 自定义请求头 / 额外请求体</h4>
    <div class="form-grid">
      <label class="form-field form-field--wide"><span class="form-field__label">自定义请求头 JSON</span><textarea class="form-input form-textarea" id="api-headers" rows="3" placeholder='{"HTTP-Referer":"https://example.com"}'>${escapeHTML(
        profile.headersJson || '{}'
      )}</textarea></label>
      <label class="form-field form-field--wide"><span class="form-field__label">合并到请求体的额外 JSON</span><textarea class="form-input form-textarea" id="api-extra-body" rows="4" placeholder='{"reasoning_effort":"high"}'>${escapeHTML(
        profile.extraBodyJson || '{}'
      )}</textarea></label>
    </div>
  </div>

  <div class="settings-subsection">
    <h4 class="settings-subsection__title">${icon('search')} 联网搜索</h4>
    <label class="check-line"><input type="checkbox" id="api-web-search" ${
      profile.webSearch?.enabled ? 'checked' : ''
    }> 为该接口启用联网开关</label>
    <p class="form-help">不同服务商的参数不同，可分别填写联网请求头与请求体，发送时会合并进普通请求。</p>
    <div class="form-grid">
      <label class="form-field form-field--wide"><span class="form-field__label">联网请求头 JSON</span><textarea class="form-input form-textarea" id="api-search-headers" rows="2">${escapeHTML(
        profile.webSearch?.headersJson || '{}'
      )}</textarea></label>
      <label class="form-field form-field--wide"><span class="form-field__label">联网请求体 JSON</span><textarea class="form-input form-textarea" id="api-search-body" rows="3">${escapeHTML(
        profile.webSearch?.bodyJson || '{"tools":[{"type":"web_search"}]}'
      )}</textarea></label>
    </div>
  </div>`;
}

function presetMarkup(preset, { builtIn = false } = {}) {
  return `<div class="preset-item">
    <div class="preset-item__body">
      <div class="preset-item__title">
        ${escapeHTML(preset.name)}
        <span class="tag">${escapeHTML(preset.provider || 'custom')}</span>
        ${builtIn ? '<span class="tag">内置</span>' : ''}
        <span class="tag ${preset.apiKey ? 'tag--pc' : ''}">${preset.apiKey ? 'Key 已保存' : '未保存 Key'}</span>
      </div>
      <p class="preset-item__meta">${escapeHTML(preset.model || '未填写模型')} · ${escapeHTML(
        preset.baseUrl || ''
      )}</p>
      ${preset.note ? `<p class="preset-item__note">${escapeHTML(preset.note)}</p>` : ''}
    </div>
    <div class="preset-item__actions">
      <button class="btn btn--gold btn--sm" type="button" ${
        builtIn
          ? `data-use-builtin-preset="${escapeHTML(preset.id)}"`
          : `data-use-saved-preset="${escapeHTML(preset.id)}"`
      }>${icon('arrow-right')} 使用</button>
      ${
        builtIn
          ? ''
          : `<button class="btn btn--ghost btn--sm btn--icon" type="button" data-delete-preset="${escapeHTML(
              preset.id
            )}" title="删除预设">${icon('trash', 'icon--sm')}</button>`
      }
    </div>
  </div>`;
}

function openPresetLibrary(ctx) {
  const settings = storage.settings.get();
  const saved = settings.api.presets || [];
  const body = document.createElement('div');
  body.innerHTML = `<p class="modal-copy">预设保存 URL、API Key 与模型名。内置预设不含 Key；点击使用后补填并保存。所有预设只保存在本机 localStorage。</p>
    <div class="settings-subsection">
      <h4 class="settings-subsection__title">${icon('spark')} 内置服务商</h4>
      <div class="preset-list">${BUILT_IN_PROVIDER_PRESETS.map((preset) => presetMarkup(preset, { builtIn: true })).join('')}</div>
    </div>
    <div class="settings-subsection">
      <h4 class="settings-subsection__title">${icon('key')} 我的预设 <span class="panel__meta">${saved.length}</span></h4>
      ${
        saved.length
          ? `<div class="preset-list">${saved.map((preset) => presetMarkup(preset)).join('')}</div>`
          : '<p class="modal-copy muted">还没有保存的预设。编辑接口时点击「保存为预设」即可。</p>'
      }
    </div>`;
  openModal({
    eyebrow: 'API Presets',
    title: '接口预设库',
    body,
    footer: `<div class="modal-actions"><button class="btn btn--ghost" type="button" data-new-preset>${icon(
      'plus'
    )} 新建接口</button><button class="btn btn--primary" type="button" data-close-dialog>关闭</button></div>`,
    onMount: (dialog) => {
      dialog.querySelectorAll('[data-use-builtin-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          const preset = BUILT_IN_PROVIDER_PRESETS.find((item) => item.id === button.dataset.useBuiltinPreset);
          if (!preset) return;
          openProfileEditor(
            normalizeApiProfile({
              name: preset.name,
              baseUrl: preset.baseUrl,
              model: preset.model,
              apiKey: '',
              temperature: 0.7,
              maxTokens: 1600,
              topP: 1,
              stream: true,
            }),
            ctx,
            { provider: preset.provider }
          );
        });
      });
      dialog.querySelectorAll('[data-use-saved-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          const preset = (storage.settings.get().api.presets || []).find(
            (item) => item.id === button.dataset.useSavedPreset
          );
          if (!preset) return toast('预设不存在。', { type: 'error' });
          const settingsNow = storage.settings.get();
          const profile = normalizeApiProfile({
            name: preset.name,
            baseUrl: preset.baseUrl,
            apiKey: preset.apiKey,
            model: preset.model,
            provider: preset.provider,
          });
          settingsNow.api.profiles.push(profile);
          settingsNow.api.activeProfileId = profile.id;
          storage.settings.save(settingsNow);
          closeModal();
          toast(`已从预设创建接口「${profile.name}」，并设为当前接口。`, { type: 'success' });
          ctx.refresh();
        });
      });
      dialog.querySelectorAll('[data-delete-preset]').forEach((button) => {
        button.addEventListener('click', async () => {
          const preset = (storage.settings.get().api.presets || []).find(
            (item) => item.id === button.dataset.deletePreset
          );
          if (!preset) return;
          const ok = await confirmDialog({
            eyebrow: '删除预设',
            title: `删除「${preset.name}」？`,
            message: '只会删除预设条目，不会删除已经创建的接口配置。',
            confirmLabel: '删除预设',
            danger: true,
          });
          if (!ok) return;
          const settingsNow = storage.settings.get();
          settingsNow.api.presets = settingsNow.api.presets.filter((item) => item.id !== preset.id);
          storage.settings.save(settingsNow);
          toast('预设已删除。', { type: 'success' });
          closeModal();
          ctx.refresh();
        });
      });
      dialog.querySelector('[data-new-preset]')?.addEventListener('click', () => openProfileEditor(null, ctx));
    },
  });
}

function collectProfile(dialog, existing) {
  const value = (id) => dialog.querySelector(`#${id}`)?.value ?? '';
  const checked = (id) => Boolean(dialog.querySelector(`#${id}`)?.checked);
  const baseUrl = value('api-base-url');
  const profile = normalizeApiProfile({
    ...existing,
    id: existing?.id,
    provider: existing?.provider || providerFromBaseUrl(baseUrl),
    name: value('api-name'),
    baseUrl,
    model: value('api-model'),
    apiKey: value('api-key'),
    temperature: Number(value('api-temperature')),
    maxTokens: Number(value('api-max-tokens')),
    topP: Number(value('api-top-p')),
    stream: checked('api-stream'),
    headersJson: value('api-headers'),
    extraBodyJson: value('api-extra-body'),
    webSearch: {
      enabled: checked('api-web-search'),
      headersJson: value('api-search-headers'),
      bodyJson: value('api-search-body'),
    },
    updatedAt: new Date().toISOString(),
  });
  if (!profile.name.trim()) throw new Error('配置名称不能为空。');
  if (!profile.model.trim()) throw new Error('Model 不能为空。');
  try {
    JSON.parse(profile.headersJson || '{}');
    JSON.parse(profile.extraBodyJson || '{}');
    JSON.parse(profile.webSearch.headersJson || '{}');
    JSON.parse(profile.webSearch.bodyJson || '{}');
  } catch (error) {
    throw new Error(`JSON 配置不合法：${error.message}`);
  }
  return profile;
}

export const settingsView = {
  async render() {
    const settings = storage.settings.get();
    const [stats, logs] = await Promise.all([
      storage.diagnostics.stats().catch(() => ({})),
      storage.logs.list(30).catch(() => []),
    ]);
    const activeId = settings.api.activeProfileId;
    const profiles = settings.api.profiles;

    return `${pageHead(
      `<span class="stage-badge"><span class="stage-badge__dot"></span>本地保险库</span>`
    )}
    <div class="settings-grid">
      <div class="settings-stack">
        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">AI 接口</h2><p class="settings-card__desc">兼容 OpenAI Chat Completions；可保存多套模型/中转配置与复用预设。</p></div>
            <div class="modal-actions">
              <button class="btn btn--ghost btn--sm" type="button" data-action="open-presets">${icon(
                'key'
              )} 接口预设 <span class="tag">${(settings.api.presets || []).length}</span></button>
              <button class="btn btn--primary btn--sm" type="button" data-action="add-api">${icon(
                'plus'
              )} 添加接口</button>
            </div>
          </div>
          ${profiles.length ? `<div class="api-profile-list">${profiles.map((profile) => profileCard(profile, activeId)).join('')}</div>` : `<div class="empty-state empty-state--compact"><p class="empty-state__text">还没有接口配置。添加一个 OpenAI 兼容接口后才能使用 AI 守秘人与 AI 车卡。</p></div>`}
          <div class="settings-subsection">
            <h4 class="settings-subsection__title">${icon('search')} 模组 AI 检测接口</h4>
            <p class="form-help">导入模组后，用所选接口做一次结构审计；推荐 DeepSeek 官方：<code>https://api.deepseek.com/v1</code> / <code>deepseek-chat</code>。</p>
            <div class="form-grid" style="margin-top:10px;">
              <label class="form-field"><span class="form-field__label">检测使用接口</span>
                <select class="form-input" id="module-check-profile" ${
                  profiles.length ? '' : 'disabled'
                }>
                  <option value="">使用当前接口</option>
                  ${profiles
                    .map(
                      (profile) =>
                        `<option value="${escapeHTML(profile.id)}" ${
                          (settings.api.moduleCheckProfileId || activeId) === profile.id ? 'selected' : ''
                        }>${escapeHTML(profile.name)} · ${escapeHTML(profile.model || '未填写模型')}</option>`
                    )
                    .join('')}
                </select>
              </label>
              <div class="form-field form-field--check">
                <span class="form-field__label">&nbsp;</span>
                <button class="btn btn--gold btn--sm" type="button" data-action="save-module-check">${icon(
                  'check'
                )} 保存检测接口</button>
              </div>
            </div>
          </div>
          <div class="privacy-note" style="margin-top:16px;">
            <p class="privacy-note__title">${icon('lock')} API Key 只存本地</p>
            <p class="privacy-note__text">密钥写入 localStorage，并通过前端 fetch 直连你填写的接口地址。本站没有后端，也不会上传密钥。公共电脑使用后请清除浏览器数据。</p>
          </div>
          <p class="form-help" style="margin-top:12px;">如果「测试连接」提示 Failed to fetch，请先确认 Base URL 与 Key；若地址本身可用，通常是服务商未允许浏览器 CORS。纯前端应用不能绕过服务端 CORS。</p>
        </section>

        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">守秘人上下文</h2><p class="settings-card__desc">控制每回合检索量、最近对话与叙事长度。</p></div>
          </div>
          <div class="form-grid">
            <label class="form-field"><span class="form-field__label">最近对话轮数</span><input class="form-input" id="kp-context-rounds" type="number" min="2" max="50" value="${settings.kp.contextRounds}"></label>
            <label class="form-field"><span class="form-field__label">检索片段数</span><input class="form-input" id="kp-retrieval-topk" type="number" min="1" max="10" value="${settings.kp.retrievalTopK}"></label>
            <label class="form-field"><span class="form-field__label">叙事最少字数</span><input class="form-input" id="kp-narrative-min" type="number" min="50" max="1000" value="${settings.kp.narrativeMin}"></label>
            <label class="form-field"><span class="form-field__label">叙事最多字数</span><input class="form-input" id="kp-narrative-max" type="number" min="100" max="2000" value="${settings.kp.narrativeMax}"></label>
          </div>
          <div class="modal-actions" style="margin-top:14px;">
            <button class="btn btn--gold" type="button" data-action="save-kp-settings">${icon(
              'check'
            )} 保存守秘人参数</button>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">API 请求日志</h2><p class="settings-card__desc">不记录密钥与完整提示词，只保留模型、耗时、Token 与错误摘要。</p></div>
            <button class="btn btn--ghost btn--sm" type="button" data-action="clear-logs">清空</button>
          </div>
          ${
            logs.length
              ? `<div class="log-table-wrap"><table class="log-table"><thead><tr><th>类型</th><th>模型</th><th>耗时</th><th>Token</th><th>状态</th><th>时间</th><th>错误</th></tr></thead><tbody>${logs
                  .map(logRow)
                  .join('')}</tbody></table></div>`
              : '<p class="modal-copy muted">还没有 API 请求记录。</p>'
          }
        </section>
      </div>

      <div class="settings-stack">
        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">界面与可访问性</h2><p class="settings-card__desc">立即写入 localStorage，并在下次打开时恢复。</p></div>
            ${icon('eye')}
          </div>
          <div class="setting-row">
            <div><p class="setting-row__title">减少动效</p><p class="setting-row__desc">关闭页面淡入、弹窗位移与启动印记旋转。</p></div>
            <button class="switch" type="button" role="switch" aria-checked="${
              settings.app.reduceMotion
            }" aria-label="减少动效" data-action="toggle-reduce-motion"></button>
          </div>
          <div class="setting-row">
            <div><p class="setting-row__title">界面语言</p><p class="setting-row__desc">当前版本仅提供简体中文。</p></div>
            <span class="tag">简体中文</span>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">本地存储</h2><p class="settings-card__desc">角色、设置存 localStorage；模组、聊天与存档存 IndexedDB。</p></div>
            <button class="btn btn--ghost btn--sm" type="button" data-action="run-storage-check">${icon(
              'refresh'
            )} 自检</button>
          </div>
          <ul class="status-list">
            <li class="status-row"><span class="status-row__dot" data-storage-local-dot></span><span class="status-row__label">localStorage</span><span class="status-row__value" data-storage-local-value>检测中…</span></li>
            <li class="status-row"><span class="status-row__dot" data-storage-idb-dot></span><span class="status-row__label">IndexedDB</span><span class="status-row__value" data-storage-idb-value>检测中…</span></li>
            <li class="status-row"><span class="status-row__dot status-row__dot--ok"></span><span class="status-row__label">档案规模</span><span class="status-row__value" data-storage-counts>读取中…</span></li>
            <li class="status-row"><span class="status-row__dot"></span><span class="status-row__label">浏览器配额</span><span class="status-row__value" data-storage-quota>读取中…</span></li>
          </ul>
          <div class="storage-meter"><span class="storage-meter__bar" data-storage-meter></span></div>
          <div class="storage-meter__caption"><span data-storage-usage>已用 —</span><span data-storage-percent>—</span></div>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn--gold" type="button" data-action="export-backup">${icon(
              'download'
            )} 导出完整备份</button>
            <button class="btn btn--ghost" type="button" data-action="import-backup">${icon(
              'upload'
            )} 导入备份</button>
            <button class="btn btn--ghost" type="button" data-action="run-dice-tests">${icon(
              'dice'
            )} 骰子自检</button>
          </div>
          <input type="file" id="backup-import" accept=".json,application/json" hidden>
          <p class="form-help" style="margin-top:12px;">完整备份包含 API 配置和密钥。请勿把备份提交到公开仓库。</p>
        </section>

        <section class="settings-card">
          <div class="settings-card__head">
            <div><h2 class="settings-card__title">关于 Cthulhu Table</h2><p class="settings-card__desc">纯前端、零构建、本地优先。</p></div>
            <img src="assets/sigil.svg" alt="" width="34" height="34" style="opacity:.65">
          </div>
          <ul class="status-list">
            <li class="status-row"><span class="status-row__label">版本</span><span class="status-row__value">v1.0.0</span></li>
            <li class="status-row"><span class="status-row__label">规则系统</span><span class="status-row__value">CoC 7th Edition</span></li>
            <li class="status-row"><span class="status-row__label">技术栈</span><span class="status-row__value">ES Modules · CSS · IndexedDB</span></li>
            <li class="status-row"><span class="status-row__label">部署</span><span class="status-row__value">GitHub Pages</span></li>
          </ul>
          <p class="rule-source">非官方同人作品，与 Chaosium Inc. 无隶属关系。请只导入你拥有使用权的模组文本。</p>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn--danger btn--sm" type="button" data-action="clear-all-data">清空全部本地数据</button>
          </div>
        </section>
      </div>
    </div>`;
  },

  async mount({ ctx }) {
    const input = document.getElementById('backup-import');
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ok = await confirmDialog({
        eyebrow: '导入完整备份',
        title: '覆盖当前本地数据？',
        message: '导入会替换当前角色、战役、模组、聊天与设置，并恢复备份中的 API 配置和密钥。该操作无法撤销。',
        confirmLabel: '导入并覆盖',
        danger: true,
      });
      if (!ok) {
        input.value = '';
        return;
      }
      try {
        const text = await file.text();
        const result = await storage.backup.import(text);
        toast(`备份已恢复：${result.characters} 角色 / ${result.campaigns} 战役 / ${result.modules} 模组。`, {
          type: 'success',
          duration: 6000,
        });
        ctx.refresh();
      } catch (error) {
        toast(error.message, { type: 'error', duration: 7000 });
      } finally {
        input.value = '';
      }
    });
    await refreshStorageStatus();
  },

  actions: {
    async 'add-api'(element, ctx) {
      openProfileEditor(null, ctx);
    },

    async 'open-presets'(element, ctx) {
      openPresetLibrary(ctx);
    },

    async 'save-module-check'(element, ctx) {
      const select = document.getElementById('module-check-profile');
      storage.settings.update({
        api: { moduleCheckProfileId: select?.value || '' },
      });
      toast(
        select?.value
          ? '模组 AI 检测接口已保存。导入模组时可以启用检测。'
          : '已设为使用当前接口。',
        { type: 'success' }
      );
      ctx.refresh();
    },

    async 'edit-api'(element, ctx) {
      const profile = storage.settings
        .get()
        .api.profiles.find((item) => item.id === element.dataset.profileId);
      if (!profile) return toast('接口配置不存在。', { type: 'error' });
      openProfileEditor(profile, ctx);
    },

    async 'activate-api'(element, ctx) {
      const settings = storage.settings.get();
      settings.api.activeProfileId = element.dataset.profileId;
      storage.settings.save(settings);
      toast('已切换当前接口。', { type: 'success' });
      ctx.refresh();
    },

    async 'delete-api'(element, ctx) {
      const settings = storage.settings.get();
      const profile = settings.api.profiles.find((item) => item.id === element.dataset.profileId);
      if (!profile) return;
      const ok = await confirmDialog({
        eyebrow: '删除接口',
        title: `删除「${profile.name}」？`,
        message: '这会从 localStorage 移除该接口配置与 API Key。已有聊天记录不会被删除。',
        confirmLabel: '删除接口',
        danger: true,
      });
      if (!ok) return;
      settings.api.profiles = settings.api.profiles.filter((item) => item.id !== profile.id);
      if (settings.api.activeProfileId === profile.id) {
        settings.api.activeProfileId = settings.api.profiles[0]?.id || '';
      }
      storage.settings.save(settings);
      toast('接口配置已删除。', { type: 'success' });
      ctx.refresh();
    },

    async 'test-api'(element) {
      const profile = storage.settings
        .get()
        .api.profiles.find((item) => item.id === element.dataset.profileId);
      if (!profile) return;
      const original = element.innerHTML;
      element.disabled = true;
      element.textContent = '测试中…';
      try {
        const result = await api.testConnection(profile);
        toast(`连接成功 · ${result.latencyMs} ms · ${result.content.slice(0, 40)}`, {
          type: 'success',
          duration: 5000,
        });
      } catch (error) {
        toast(`连接失败：${error.message}`, { type: 'error', duration: 7000 });
      } finally {
        element.disabled = false;
        element.innerHTML = original;
      }
    },

    async 'save-kp-settings'(element, ctx) {
      const value = (id) => Number(document.getElementById(id)?.value);
      storage.settings.update({
        kp: {
          contextRounds: Math.max(2, Math.min(50, value('kp-context-rounds') || 12)),
          retrievalTopK: Math.max(1, Math.min(10, value('kp-retrieval-topk') || 4)),
          narrativeMin: Math.max(50, Math.min(1000, value('kp-narrative-min') || 200)),
          narrativeMax: Math.max(100, Math.min(2000, value('kp-narrative-max') || 400)),
        },
      });
      toast('守秘人参数已保存。', { type: 'success' });
      ctx.refresh();
    },

    async 'toggle-reduce-motion'(element) {
      const next = !storage.settings.get().app.reduceMotion;
      storage.settings.set('app.reduceMotion', next);
      document.documentElement.dataset.reduceMotion = next ? 'true' : 'false';
      element.setAttribute('aria-checked', String(next));
      toast(next ? '已减少界面动效。' : '已恢复界面动效。', { type: 'info', duration: 2200 });
    },

    async 'run-storage-check'(element) {
      const original = element.innerHTML;
      element.disabled = true;
      element.textContent = '自检中…';
      try {
        const result = await storage.diagnostics.selfTest();
        await refreshStorageStatus();
        if (result.ok) {
          toast(`本地存储正常，耗时 ${result.latencyMs} ms。`, { type: 'success' });
        } else {
          toast(result.errors.join(' ') || '自检未完全通过。', { type: 'error', duration: 7000 });
        }
      } finally {
        element.disabled = false;
        element.innerHTML = original;
      }
    },

    async 'export-backup'() {
      const backup = await storage.backup.export();
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`cthulhu-table-backup-${date}.json`, JSON.stringify(backup, null, 2));
      toast('完整备份已导出。请妥善保管，其中包含 API 配置。', {
        type: 'success',
        duration: 5200,
      });
    },

    async 'import-backup'() {
      document.getElementById('backup-import')?.click();
    },

    async 'run-dice-tests'() {
      const { runDiceTests } = await import('../dice.test.js');
      const result = runDiceTests();
      openModal({
        eyebrow: 'Dice Engine Tests',
        title: result.failed ? '骰子自检未通过' : '骰子自检通过',
        body: `<p class="modal-copy">${result.passed} 通过 / ${result.failed} 失败 / 共 ${result.total} 项。</p>${
          result.failures.length
            ? `<ul class="modal-list">${result.failures.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
            : '<p class="modal-copy muted">所有断言均通过。详细输出已写入浏览器控制台。</p>'
        }`,
        footer: `<div class="modal-actions"><button class="btn btn--primary" type="button" data-close-dialog>关闭</button></div>`,
      });
    },

    async 'clear-logs'(element, ctx) {
      const ok = await confirmDialog({
        eyebrow: '清空日志',
        title: '清空 API 请求日志？',
        message: '不会影响聊天、角色或接口配置。',
        confirmLabel: '清空日志',
        danger: true,
      });
      if (!ok) return;
      await storage.logs.clear();
      toast('API 日志已清空。', { type: 'success' });
      ctx.refresh();
    },

    async 'clear-all-data'(element, ctx) {
      const ok = await confirmDialog({
        eyebrow: '危险操作',
        title: '清空全部本地数据？',
        message: '角色、战役、模组、聊天、存档、设置与 API Key 会被全部删除，且无法恢复。请先导出备份。',
        confirmLabel: '确认清空',
        danger: true,
      });
      if (!ok) return;
      await storage.clearAll();
      toast('全部本地数据已清空。', { type: 'success' });
      ctx.navigate('#/home');
    },
  },
};

function modelPickerMarkup(groups, currentModel = '') {
  if (!groups.length) {
    return `<div class="model-picker__empty">${icon(
      'alert'
    )} 接口没有返回可用模型。你仍然可以手动填写模型名。</div>`;
  }
  return `<div class="model-picker__head">
      <strong>${icon('spark')} 可用模型</strong>
      <span>${PRICE_NOTE}</span>
    </div>
    ${groups
      .map(
        (group) => `<section class="model-group">
          <h5 class="model-group__title">${escapeHTML(group.label)} <span>${group.models.length}</span></h5>
          <div class="model-group__list">
            ${group.models
              .map(
                (model) => `<button class="model-option ${
                  model.id === currentModel ? 'is-selected' : ''
                }" type="button" data-select-model="${escapeHTML(model.id)}">
                  <span class="model-option__id">${escapeHTML(model.id)}</span>
                  <span class="model-option__price ${model.price ? '' : 'is-unknown'}">${escapeHTML(
                    formatPrice(model.price)
                  )}${model.price?.source === 'api' ? ' · 接口价' : ''}</span>
                </button>`
              )
              .join('')}
          </div>
        </section>`
      )
      .join('')}`;
}

function providerFromBaseUrl(baseUrl) {
  const value = String(baseUrl || '').toLowerCase();
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('openrouter')) return 'openrouter';
  if (value.includes('siliconflow')) return 'siliconflow';
  if (value.includes('anthropic')) return 'anthropic';
  if (value.includes('google') || value.includes('generativelanguage')) return 'google';
  if (value.includes('moonshot')) return 'moonshotai';
  if (value.includes('openai')) return 'openai';
  return 'custom';
}

function openProfileEditor(existing, ctx, { provider = '' } = {}) {
  const profile = existing || normalizeApiProfile({ name: '新的接口', model: '' });
  openModal({
    eyebrow: existing ? 'Edit API Profile' : 'New API Profile',
    title: existing ? '编辑接口配置' : '添加接口',
    body: profileForm(profile),
    footer: `<div class="modal-actions">
      <button class="btn btn--ghost" type="button" data-close-dialog>取消</button>
      <button class="btn btn--gold" type="button" data-save-preset>${icon(
        'key'
      )} 保存为预设</button>
      <button class="btn btn--ghost" type="button" data-test-profile>${icon(
        'refresh'
      )} 测试连接</button>
      <button class="btn btn--primary" type="button" data-save-profile>${icon(
        'check'
      )} 保存配置</button>
    </div>`,
    onMount: (dialog) => {
      dialog.querySelectorAll('[data-fill-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          const preset = BUILT_IN_PROVIDER_PRESETS.find((item) => item.id === button.dataset.fillPreset);
          if (!preset) return;
          const set = (id, value) => {
            const input = dialog.querySelector(`#${id}`);
            if (input) input.value = value;
          };
          set('api-name', preset.name);
          set('api-base-url', preset.baseUrl);
          set('api-model', preset.model);
          const picker = dialog.querySelector('#model-picker');
          if (picker) picker.hidden = true;
          toast(`已填入 ${preset.name} 的 URL 与模型；请补充 API Key。`, {
            type: 'info',
            duration: 3500,
          });
        });
      });

      dialog.querySelector('[data-detect-models]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const picker = dialog.querySelector('#model-picker');
        const baseUrl = dialog.querySelector('#api-base-url')?.value?.trim() || '';
        const apiKey = dialog.querySelector('#api-key')?.value || '';
        const headersJson = dialog.querySelector('#api-headers')?.value || '{}';
        const currentModel = dialog.querySelector('#api-model')?.value || '';
        if (!baseUrl) return toast('请先填写 Base URL。', { type: 'error' });
        const original = button.innerHTML;
        button.disabled = true;
        button.textContent = '检测中…';
        if (picker) {
          picker.hidden = false;
          picker.innerHTML = `<div class="model-picker__loading">${icon(
            'refresh'
          )} 正在请求 /models，部分服务商可能不支持该端点…</div>`;
        }
        try {
          const result = await api.listModels(
            {
              baseUrl,
              apiKey,
              headersJson,
              webSearch: { enabled: false },
            },
            { retries: 1 }
          );
          const groups = groupModels(result.models, {
            fallbackProvider: providerFromBaseUrl(baseUrl),
            baseUrl,
          });
          if (picker) {
            picker.innerHTML = modelPickerMarkup(groups, currentModel);
            picker.querySelectorAll('[data-select-model]').forEach((option) => {
              option.addEventListener('click', () => {
                const modelInput = dialog.querySelector('#api-model');
                if (modelInput) modelInput.value = option.dataset.selectModel;
                picker.querySelectorAll('[data-select-model]').forEach((item) => {
                  item.classList.toggle('is-selected', item === option);
                });
                toast(`已选择模型：${option.dataset.selectModel}`, {
                  type: 'success',
                  duration: 2500,
                });
              });
            });
          }
          toast(`检测到 ${result.models.length} 个模型，已按服务商与参考价格分组。`, {
            type: 'success',
            duration: 4000,
          });
        } catch (error) {
          if (picker) {
            picker.innerHTML = `<div class="model-picker__error">${icon(
              'alert'
            )} ${escapeHTML(error.message)}<br><span>你仍然可以手动填写模型名。</span></div>`;
          }
          toast(`模型检测失败：${error.message}`, { type: 'error', duration: 7000 });
        } finally {
          button.disabled = false;
          button.innerHTML = original;
        }
      });

      dialog.querySelector('[data-save-profile]')?.addEventListener('click', () => {
        try {
          const next = collectProfile(dialog, existing);
          const settings = storage.settings.get();
          const index = settings.api.profiles.findIndex((item) => item.id === next.id);
          const isNew = index < 0;
          if (!isNew) settings.api.profiles[index] = next;
          else settings.api.profiles.push(next);
          // 新建接口默认设为当前接口，避免“保存了但守秘人仍在用旧配置”的困惑。
          if (isNew || !settings.api.activeProfileId) settings.api.activeProfileId = next.id;
          storage.settings.save(settings);
          closeModal();
          toast(
            isNew ? '接口配置已保存，并设为当前接口。' : '接口配置已保存。',
            { type: 'success' }
          );
          ctx.refresh();
        } catch (error) {
          toast(error.message, { type: 'error', duration: 6000 });
        }
      });

      dialog.querySelector('[data-save-preset]')?.addEventListener('click', () => {
        try {
          const next = collectProfile(dialog, existing);
          const settingsNow = storage.settings.get();
          const preset = normalizeApiPreset({
            provider: provider || providerFromBaseUrl(next.baseUrl),
            name: next.name,
            baseUrl: next.baseUrl,
            apiKey: next.apiKey,
            model: next.model,
          });
          const index = settingsNow.api.presets.findIndex(
            (item) => item.name.toLowerCase() === preset.name.toLowerCase()
          );
          if (index >= 0) settingsNow.api.presets[index] = preset;
          else settingsNow.api.presets.push(preset);
          storage.settings.save(settingsNow);
          toast(`预设「${preset.name}」已保存，可在「接口预设」中复用。`, {
            type: 'success',
            duration: 4500,
          });
        } catch (error) {
          toast(error.message, { type: 'error', duration: 6000 });
        }
      });

      dialog.querySelector('[data-test-profile]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const original = button.innerHTML;
        button.disabled = true;
        button.textContent = '测试中…';
        try {
          const candidate = collectProfile(dialog, existing);
          const result = await api.testConnection(candidate);
          toast(`连接成功 · ${result.latencyMs} ms · ${result.content.slice(0, 40)}`, {
            type: 'success',
            duration: 5000,
          });
        } catch (error) {
          toast(`连接失败：${error.message}`, { type: 'error', duration: 7000 });
        } finally {
          button.disabled = false;
          button.innerHTML = original;
        }
      });
    },
  });
}

async function refreshStorageStatus() {
  if (!document.querySelector('[data-storage-local-value]')) return;
  try {
    const stats = await storage.diagnostics.stats();
    const localDot = document.querySelector('[data-storage-local-dot]');
    const idbDot = document.querySelector('[data-storage-idb-dot]');
    localDot?.classList.toggle('status-row__dot--ok', stats.localAvailable);
    localDot?.classList.toggle('status-row__dot--bad', !stats.localAvailable);
    idbDot?.classList.toggle('status-row__dot--ok', stats.indexedDbAvailable);
    idbDot?.classList.toggle('status-row__dot--bad', !stats.indexedDbAvailable);
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = String(value);
    };
    setText('[data-storage-local-value]', stats.localAvailable ? '可用' : '不可用 · 内存降级');
    setText('[data-storage-idb-value]', stats.indexedDbAvailable ? '可用' : '不可用');
    setText(
      '[data-storage-counts]',
      `${stats.characters} 角色 · ${stats.campaigns || 0} 战役 · ${stats.modules} 模组 · ${stats.chats} 对话 · ${stats.saves} 存档`
    );
    setText(
      '[data-storage-quota]',
      stats.quota ? `${formatBytes(stats.usage)} / ${formatBytes(stats.quota)}` : '浏览器未提供'
    );
    setText('[data-storage-usage]', `已用 ${formatBytes(stats.usage)}`);
    setText('[data-storage-percent]', stats.usagePercent ? `${stats.usagePercent.toFixed(1)}%` : '—');
    const meter = document.querySelector('[data-storage-meter]');
    if (meter) meter.style.width = `${Math.max(0, Math.min(100, stats.usagePercent))}%`;
  } catch (error) {
    console.warn('[Cthulhu Table] 存储状态读取失败：', error);
  }
}

export default settingsView;
