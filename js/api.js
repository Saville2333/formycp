/**
 * api.js — OpenAI Chat Completions 兼容接口层
 *
 * 支持：
 * - 多套接口配置（由 settings.api.profiles 提供）
 * - 自定义 baseURL / 请求头 / 额外请求体
 * - SSE 流式解析与逐字回调
 * - 联网开关（按配置合并 tools 等请求体/header）
 * - 超时、AbortSignal、429/5xx 自动重试
 * - 请求日志（不记录 API Key）
 *
 * 隐私：API Key 只从 localStorage 读取，通过前端 fetch 直连用户填写的接口，
 * 不发送给本应用的任何服务器（本应用没有服务器）。
 */

import { storage } from './storage.js';

export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, retryable = false, body = '', cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.body = body;
    this.cause = cause;
  }
}

export const API_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  temperature: 0.7,
  maxTokens: 1600,
  topP: 1,
  stream: true,
  requestTimeoutMs: 120000,
  retries: 2,
});

/* =========================================================
 * 配置与请求组装
 * ========================================================= */

export function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new ApiError('Base URL 不能为空。', { code: 'INVALID_BASE_URL' });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(`Base URL 格式不正确：${raw}`, { code: 'INVALID_BASE_URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError('Base URL 必须使用 http:// 或 https://。', { code: 'INVALID_BASE_URL' });
  }
  parsed.hash = '';
  let path = parsed.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(path)) {
    path = `${path}/chat/completions`;
  }
  parsed.pathname = path.replace(/\/{2,}/g, '/');
  return parsed.toString();
}

function safeMerge(target, patch) {
  if (!isPlainObject(patch)) return target;
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    if (isPlainObject(value) && isPlainObject(target[key])) {
      safeMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(text, label) {
  if (!String(text || '').trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ApiError(`${label}不是合法 JSON：${error.message}`, {
      code: 'INVALID_JSON_SETTING',
    });
  }
  if (!isPlainObject(parsed)) {
    throw new ApiError(`${label}必须是一个 JSON 对象。`, { code: 'INVALID_JSON_SETTING' });
  }
  return parsed;
}

export function buildHeaders(profile, { useWebSearch = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  };
  if (profile?.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
  const custom = parseJsonObject(profile?.headersJson || '{}', '自定义请求头');
  for (const [key, value] of Object.entries(custom)) {
    if (value === null || value === undefined) continue;
    headers[key] = String(value);
  }
  if (useWebSearch && profile?.webSearch?.enabled) {
    const searchHeaders = parseJsonObject(profile.webSearch.headersJson || '{}', '联网请求头');
    for (const [key, value] of Object.entries(searchHeaders)) {
      if (value === null || value === undefined) continue;
      headers[key] = String(value);
    }
  }
  return headers;
}

export function buildRequestBody(profile, messages, { stream = true, useWebSearch = false } = {}) {
  if (!profile || typeof profile !== 'object') {
    throw new ApiError('接口配置不存在。', { code: 'MISSING_PROFILE' });
  }
  if (!profile.model) {
    throw new ApiError('接口配置缺少 Model。', { code: 'MISSING_MODEL' });
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new ApiError('消息列表不能为空。', { code: 'EMPTY_MESSAGES' });
  }

  const body = {
    model: profile.model,
    messages,
    temperature: Number(profile.temperature ?? API_DEFAULTS.temperature),
    max_tokens: Math.max(1, Math.floor(Number(profile.maxTokens) || API_DEFAULTS.maxTokens)),
    top_p: Number(profile.topP ?? API_DEFAULTS.topP),
    stream,
  };

  const extra = parseJsonObject(profile.extraBodyJson || '{}', '额外请求体');
  safeMerge(body, extra);

  if (useWebSearch && profile?.webSearch?.enabled) {
    const searchBody = parseJsonObject(profile.webSearch.bodyJson || '{}', '联网请求体');
    safeMerge(body, searchBody);
  }

  // 防止额外请求体把关键字段改成非法值。
  body.stream = Boolean(stream);
  if (!Array.isArray(body.messages) || !body.messages.length) {
    throw new ApiError('额外请求体不能覆盖 messages 为空。', { code: 'INVALID_EXTRA_BODY' });
  }
  return body;
}

export function endpointForProfile(profile) {
  return normalizeBaseUrl(profile?.baseUrl || API_DEFAULTS.baseUrl);
}

export function endpointHost(profile) {
  try {
    return new URL(endpointForProfile(profile)).host;
  } catch {
    return 'invalid-endpoint';
  }
}

/* =========================================================
 * SSE 解析
 * ========================================================= */

/**
 * 增量 SSE 解析器。OpenAI 格式通常为：
 * data: {"choices":[{"delta":{"content":"..."}}]}
 * 空行分隔事件，[DONE] 结束。
 */
export function createSseParser(onData) {
  let buffer = '';

  function processEvent(block) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    if (!dataLines.length) return;
    const payload = dataLines.join('\n').trim();
    if (!payload) return;
    onData(payload);
  }

  return {
    feed(chunk) {
      buffer += String(chunk ?? '');
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(boundary + (match?.[0].length || 2));
        processEvent(block);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    flush() {
      if (buffer.trim()) processEvent(buffer);
      buffer = '';
    },
  };
}

function contentFromPayload(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) return '';
  const content = choice.delta?.content ?? choice.message?.content ?? choice.text ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        return part?.text || part?.content || '';
      })
      .join('');
  }
  return '';
}

function usageFromPayload(payload) {
  const usage = payload?.usage;
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? 0,
    completionTokens: usage.completion_tokens ?? usage.completionTokens ?? 0,
    totalTokens: usage.total_tokens ?? usage.totalTokens ?? 0,
  };
}

/* =========================================================
 * 网络请求与重试
 * ========================================================= */

function createCombinedSignal(externalSignal, timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeoutSignal = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || API_DEFAULTS.requestTimeoutMs));
    if (!externalSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), Math.max(1000, Number(timeoutMs) || API_DEFAULTS.requestTimeoutMs));
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }
  const originalAbort = controller.abort.bind(controller);
  controller.abort = (reason) => {
    clearTimeout(timer);
    originalAbort(reason);
  };
  return controller.signal;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return '';
  }
}

function statusMessage(status, body) {
  const snippet = body ? `：${body.slice(0, 300)}` : '';
  if (status === 401) return `认证失败（401）。请检查 API Key。${snippet}`;
  if (status === 403) return `接口拒绝访问（403）。${snippet}`;
  if (status === 404) return `接口地址不存在（404）。请检查 Base URL。${snippet}`;
  if (status === 429) return `请求过于频繁或额度不足（429）。${snippet}`;
  if (status >= 500) return `接口服务端错误（${status}）。${snippet}`;
  return `接口返回错误（${status}）${snippet}`;
}

async function requestWithRetry(url, initFactory, { retries = 2, signal, timeoutMs } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const init = initFactory();
      const response = await fetch(url, {
        ...init,
        signal: createCombinedSignal(signal, timeoutMs),
      });
      if (!response.ok) {
        const body = await readErrorBody(response);
        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < retries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 700 * 2 ** attempt;
          await sleep(delay, signal);
          attempt += 1;
          continue;
        }
        throw new ApiError(statusMessage(response.status, body), {
          code: 'HTTP_ERROR',
          status: response.status,
          retryable,
          body,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError') throw error;
      if (error?.name === 'TimeoutError') {
        throw new ApiError('请求超时。请检查接口地址、网络或调大超时时间。', {
          code: 'TIMEOUT',
          retryable: false,
          cause: error,
        });
      }
      if (attempt < retries) {
        await sleep(700 * 2 ** attempt, signal);
        attempt += 1;
        continue;
      }
      throw new ApiError(`网络请求失败：${error.message}`, {
        code: 'NETWORK_ERROR',
        retryable: true,
        cause: error,
      });
    }
  }
  throw new ApiError('请求重试次数耗尽。', { code: 'RETRY_EXHAUSTED' });
}

async function logRequest(profile, log) {
  try {
    await storage.logs.add({
      category: log.category || 'chat',
      model: profile?.model || '',
      endpointHost: endpointHost(profile),
      durationMs: log.durationMs,
      status: log.status,
      success: log.success,
      usage: log.usage || null,
      error: log.error ? String(log.error).slice(0, 500) : '',
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // 日志失败不能影响对话。
    console.warn('[Cthulhu Table] API 日志写入失败：', error);
  }
}

/* =========================================================
 * 对话补全
 * ========================================================= */

function extractNonStreamContent(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? payload?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || '').join('');
  }
  return '';
}

/**
 * 非流式补全。始终使用 stream:false，适合 AI 车卡和连通性测试。
 */
export async function complete(
  profile,
  messages,
  { signal, timeoutMs = API_DEFAULTS.requestTimeoutMs, retries = 2, useWebSearch = true } = {}
) {
  const startedAt = performance.now();
  const url = endpointForProfile(profile);
  const headers = buildHeaders(profile, { useWebSearch });
  const body = buildRequestBody(profile, messages, { stream: false, useWebSearch });
  let response;
  try {
    response = await requestWithRetry(
      url,
      () => ({
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      { retries, signal, timeoutMs }
    );
    const payload = await response.json();
    const content = extractNonStreamContent(payload);
    if (!content) {
      throw new ApiError('接口返回成功，但没有可用的文本内容。', {
        code: 'EMPTY_RESPONSE',
        body: JSON.stringify(payload).slice(0, 2000),
      });
    }
    const usage = usageFromPayload(payload);
    const durationMs = Math.round(performance.now() - startedAt);
    void logRequest(profile, { category: 'completion', durationMs, status: 200, success: true, usage });
    return {
      content,
      usage,
      durationMs,
      raw: payload,
      endpointHost: endpointHost(profile),
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    void logRequest(profile, {
      category: 'completion',
      durationMs,
      status: error.status || 0,
      success: false,
      error: error.message,
    });
    throw error;
  }
}

/**
 * SSE 流式补全。每收到一段增量就调用 onDelta(delta, contentSoFar)。
 * 返回完整内容、usage 与耗时。
 */
export async function streamChat(
  profile,
  messages,
  { signal, timeoutMs = API_DEFAULTS.requestTimeoutMs, retries = 2, useWebSearch = true, onDelta } = {}
) {
  const startedAt = performance.now();
  const url = endpointForProfile(profile);
  const headers = buildHeaders(profile, { useWebSearch });
  const body = buildRequestBody(profile, messages, { stream: true, useWebSearch });
  let content = '';
  let usage = null;

  try {
    const response = await requestWithRetry(
      url,
      () => ({
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      { retries, signal, timeoutMs }
    );

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      // 某些中转会忽略 stream:true，直接返回 JSON。这里做兼容。
      const payload = await response.json();
      content = extractNonStreamContent(payload);
      usage = usageFromPayload(payload);
      if (!content) {
        throw new ApiError('接口没有返回流式内容，也没有返回普通文本。', {
          code: 'EMPTY_RESPONSE',
        });
      }
      if (typeof onDelta === 'function') onDelta(content, content);
      const durationMs = Math.round(performance.now() - startedAt);
      void logRequest(profile, { category: 'stream', durationMs, status: 200, success: true, usage });
      return { content, usage, durationMs, endpointHost: endpointHost(profile), fallback: true };
    }

    if (!response.body) {
      throw new ApiError('当前浏览器或接口不支持读取流式响应体。', {
        code: 'STREAM_UNSUPPORTED',
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let streamError = null;
    let done = false;
    const parser = createSseParser((raw) => {
      if (raw === '[DONE]') {
        done = true;
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return; // 忽略非 JSON 心跳/注释
      }
      if (payload?.error) {
        streamError = new ApiError(payload.error.message || '流式接口返回错误。', {
          code: 'STREAM_ERROR',
          body: JSON.stringify(payload.error).slice(0, 1000),
        });
        return;
      }
      const delta = contentFromPayload(payload);
      const nextUsage = usageFromPayload(payload);
      if (nextUsage) usage = nextUsage;
      if (delta) {
        content += delta;
        if (typeof onDelta === 'function') onDelta(delta, content);
      }
    });

    while (!done) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      parser.feed(decoder.decode(value, { stream: true }));
      if (streamError) {
        await reader.cancel();
        throw streamError;
      }
    }
    parser.feed(decoder.decode());
    parser.flush();
    if (streamError) throw streamError;

    if (!content.trim()) {
      throw new ApiError('流式响应结束，但没有收到任何文本。', { code: 'EMPTY_RESPONSE' });
    }

    const durationMs = Math.round(performance.now() - startedAt);
    void logRequest(profile, { category: 'stream', durationMs, status: 200, success: true, usage });
    return { content, usage, durationMs, endpointHost: endpointHost(profile), fallback: false };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    void logRequest(profile, {
      category: 'stream',
      durationMs,
      status: error.status || 0,
      success: false,
      error: error.message,
    });
    throw error;
  }
}

/**
 * 根据 profile.stream 自动选择流式或非流式。
 */
export async function chat(profile, messages, options = {}) {
  if (profile?.stream !== false && typeof options.onDelta === 'function') {
    return streamChat(profile, messages, options);
  }
  return complete(profile, messages, options);
}

/**
 * 连通性测试：请求一个极短的回复。
 */
export async function testConnection(profile, { signal, timeoutMs = 30000 } = {}) {
  const startedAt = performance.now();
  const result = await complete(
    profile,
    [{ role: 'user', content: '请只回复两个字：在线' }],
    { signal, timeoutMs, retries: 1, useWebSearch: false }
  );
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt),
    content: result.content,
    model: profile.model,
    endpointHost: endpointHost(profile),
  };
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export const api = Object.freeze({
  complete,
  streamChat,
  chat,
  testConnection,
  buildHeaders,
  buildRequestBody,
  endpointForProfile,
  normalizeBaseUrl,
  createSseParser,
  isAbortError,
  ApiError,
  API_DEFAULTS,
});

export default api;
