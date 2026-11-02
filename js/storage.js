/**
 * storage.js — Cthulhu Table 的本地持久化层
 *
 * 设计原则：
 * 1. localStorage 只存设置、角色卡、UI 偏好等轻量数据；
 * 2. IndexedDB 存模组原文、聊天记录、存档、API 日志等可能很大的数据；
 * 3. 所有数据结构都带 schemaVersion，为后续阶段迁移留出空间；
 * 4. 不向任何服务器发送数据。API Key 同样只保存在当前浏览器的 localStorage。
 *
 * 注意：浏览器隐私模式下 localStorage / IndexedDB 可能不可用。
 * 本模块会降级到内存存储，并在自检中明确报告，不假装数据已经持久化。
 */

export const APP_VERSION = '0.1.0';
export const SCHEMA_VERSION = 1;

const LS_PREFIX = 'cthulhu-table';
const DB_NAME = 'cthulhu-table';
const DB_VERSION = 1;
const MEMORY_FALLBACK = new Map();

export const STORAGE_KEYS = Object.freeze({
  settings: `${LS_PREFIX}:settings:v1`,
  characters: `${LS_PREFIX}:characters:v1`,
  ui: `${LS_PREFIX}:ui:v1`,
});

export const DB_STORES = Object.freeze({
  modules: 'modules',
  chats: 'chats',
  saves: 'saves',
  apiLogs: 'apiLogs',
  meta: 'meta',
});

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  app: {
    reduceMotion: false,
    lastRoute: '/home',
  },
  api: {
    profiles: [],
    activeProfileId: '',
    requestTimeoutMs: 120000,
  },
  kp: {
    contextRounds: 12,
    retrievalTopK: 4,
    narrativeMin: 200,
    narrativeMax: 400,
    showInternalState: false,
  },
  privacy: {
    acknowledgedLocalKey: false,
  },
});

export class StorageError extends Error {
  constructor(message, { code = 'STORAGE_ERROR', cause = null } = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

/* =========================================================
 * 通用工具
 * ========================================================= */

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix = 'id') {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return `${prefix}_${cryptoObject.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 某些环境不支持结构化克隆时，退回 JSON。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只合并普通对象；数组、标量和 null 直接覆盖。 */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return clone(patch);
  const result = isPlainObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDate(value, fallback = nowIso()) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return fallback;
}

function emit(name, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** 防止 IndexedDB 被浏览器策略阻塞时，诊断界面永远停在“检测中”。 */
function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new StorageError(message, { code: 'STORAGE_TIMEOUT' }));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/* =========================================================
 * localStorage 基础读写（带内存降级）
 * ========================================================= */

let localStorageAvailable = null;

export function isLocalStorageAvailable() {
  if (localStorageAvailable !== null) return localStorageAvailable;
  try {
    const probe = `${LS_PREFIX}:__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    localStorageAvailable = true;
  } catch {
    localStorageAvailable = false;
  }
  return localStorageAvailable;
}

function readRaw(key) {
  if (!isLocalStorageAvailable()) {
    return MEMORY_FALLBACK.has(key) ? MEMORY_FALLBACK.get(key) : null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return MEMORY_FALLBACK.has(key) ? MEMORY_FALLBACK.get(key) : null;
  }
}

function writeRaw(key, value) {
  if (!isLocalStorageAvailable()) {
    MEMORY_FALLBACK.set(key, value);
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // 容量不足时不再静默写入内存，否则用户会误以为已经持久化。
    if (error && (error.name === 'QuotaExceededError' || error.code === 22)) {
      throw new StorageError('浏览器本地存储空间不足，请先导出备份并清理旧数据。', {
        code: 'QUOTA_EXCEEDED',
        cause: error,
      });
    }
    throw new StorageError('写入 localStorage 失败。', {
      code: 'LOCAL_WRITE_FAILED',
      cause: error,
    });
  }
}

function removeRaw(key) {
  if (!isLocalStorageAvailable()) {
    MEMORY_FALLBACK.delete(key);
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    MEMORY_FALLBACK.delete(key);
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (!raw) return clone(fallback);
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[Cthulhu Table] 无法解析本地数据：${key}，已使用默认值。`);
    return clone(fallback);
  }
}

function writeJSON(key, value) {
  writeRaw(key, JSON.stringify(value));
}

/* =========================================================
 * 设置
 * ========================================================= */

export function normalizeApiProfile(input = {}) {
  const profile = isPlainObject(input) ? clone(input) : {};
  return {
    id: typeof profile.id === 'string' && profile.id ? profile.id : createId('api'),
    name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : '未命名接口',
    baseUrl: typeof profile.baseUrl === 'string' ? profile.baseUrl.trim() : 'https://api.openai.com/v1',
    apiKey: typeof profile.apiKey === 'string' ? profile.apiKey : '',
    model: typeof profile.model === 'string' ? profile.model.trim() : '',
    temperature: toSafeNumber(profile.temperature, 0.7),
    maxTokens: Math.max(1, Math.round(toSafeNumber(profile.maxTokens, 1600))),
    topP: toSafeNumber(profile.topP, 1),
    stream: profile.stream !== false,
    headersJson: typeof profile.headersJson === 'string' ? profile.headersJson : '{}',
    extraBodyJson: typeof profile.extraBodyJson === 'string' ? profile.extraBodyJson : '{}',
    webSearch: {
      enabled: Boolean(profile.webSearch && profile.webSearch.enabled),
      headersJson:
        typeof profile.webSearch?.headersJson === 'string' ? profile.webSearch.headersJson : '{}',
      bodyJson:
        typeof profile.webSearch?.bodyJson === 'string'
          ? profile.webSearch.bodyJson
          : '{"tools":[{"type":"web_search"}]}',
    },
    createdAt: normalizeDate(profile.createdAt),
    updatedAt: normalizeDate(profile.updatedAt),
  };
}

export function normalizeSettings(input) {
  const merged = deepMerge(clone(DEFAULT_SETTINGS), isPlainObject(input) ? input : {});
  const profiles = Array.isArray(merged.api?.profiles)
    ? merged.api.profiles.map(normalizeApiProfile)
    : [];
  merged.schemaVersion = SCHEMA_VERSION;
  merged.api = {
    ...DEFAULT_SETTINGS.api,
    ...(isPlainObject(merged.api) ? merged.api : {}),
    profiles,
  };
  merged.api.activeProfileId =
    typeof merged.api.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === merged.api.activeProfileId)
      ? merged.api.activeProfileId
      : profiles[0]?.id || '';
  merged.app = { ...clone(DEFAULT_SETTINGS.app), ...(isPlainObject(merged.app) ? merged.app : {}) };
  merged.kp = { ...clone(DEFAULT_SETTINGS.kp), ...(isPlainObject(merged.kp) ? merged.kp : {}) };
  merged.privacy = {
    ...clone(DEFAULT_SETTINGS.privacy),
    ...(isPlainObject(merged.privacy) ? merged.privacy : {}),
  };
  merged.app.reduceMotion = Boolean(merged.app.reduceMotion);
  merged.kp.showInternalState = Boolean(merged.kp.showInternalState);
  merged.privacy.acknowledgedLocalKey = Boolean(merged.privacy.acknowledgedLocalKey);
  return merged;
}

export function getSettings() {
  return normalizeSettings(readJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
}

export function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  writeJSON(STORAGE_KEYS.settings, normalized);
  emit('cthulhu:settings-changed', normalized);
  return normalized;
}

export function updateSettings(patch) {
  return saveSettings(deepMerge(getSettings(), patch));
}

/** 通过点路径更新单个设置，例如 setSetting('app.reduceMotion', true)。 */
export function setSetting(path, value) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new StorageError('设置路径不能为空。', { code: 'INVALID_PATH' });
  }
  const settings = getSettings();
  const keys = path.split('.').filter(Boolean);
  let cursor = settings;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return saveSettings(settings);
}

export function getActiveApiProfile(settings = getSettings()) {
  return settings.api.profiles.find((profile) => profile.id === settings.api.activeProfileId) || null;
}

/* =========================================================
 * 角色卡（localStorage）
 * ========================================================= */

const EMPTY_CHARACTERS = { schemaVersion: SCHEMA_VERSION, items: {} };

function readCharacterContainer() {
  const raw = readJSON(STORAGE_KEYS.characters, EMPTY_CHARACTERS);
  // 兼容旧版本/手工导入的三种形态：数组、id->角色 映射、{ items } 容器。
  if (Array.isArray(raw)) {
    const items = {};
    for (const item of raw) {
      if (item && typeof item.id === 'string') items[item.id] = item;
    }
    return { schemaVersion: SCHEMA_VERSION, items };
  }
  if (isPlainObject(raw) && isPlainObject(raw.items)) {
    return { schemaVersion: SCHEMA_VERSION, items: raw.items };
  }
  if (isPlainObject(raw)) {
    const maybeItems = {};
    for (const [key, value] of Object.entries(raw)) {
      if (isPlainObject(value) && typeof value.name === 'string') maybeItems[key] = value;
    }
    if (Object.keys(maybeItems).length) {
      return { schemaVersion: SCHEMA_VERSION, items: maybeItems };
    }
  }
  return clone(EMPTY_CHARACTERS);
}

function writeCharacterContainer(container) {
  writeJSON(STORAGE_KEYS.characters, {
    schemaVersion: SCHEMA_VERSION,
    items: container.items,
  });
  emit('cthulhu:characters-changed', { count: Object.keys(container.items).length });
}

/**
 * 第一阶段的轻量校验：只保证存储层不会接收无法辨识的坏数据。
 * 完整的 CoC 七版数值校验在第二阶段 character.js 中实现。
 */
export function validateCharacterBasic(character) {
  const errors = [];
  if (!isPlainObject(character)) {
    return { valid: false, errors: ['角色数据必须是一个 JSON 对象。'] };
  }
  if (typeof character.name !== 'string' || !character.name.trim()) {
    errors.push('缺少角色姓名 name。');
  }
  if (character.kind !== undefined && !['pc', 'npc'].includes(character.kind)) {
    errors.push('kind 只能是 pc 或 npc。');
  }
  if (character.age !== undefined) {
    const age = Number(character.age);
    if (!Number.isFinite(age) || age < 15 || age > 120) {
      errors.push('年龄必须在 15—120 之间。');
    }
  }
  if (character.attributes !== undefined) {
    if (!isPlainObject(character.attributes)) {
      errors.push('attributes 必须是对象。');
    } else {
      const keys = ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'];
      for (const key of keys) {
        if (character.attributes[key] !== undefined) {
          const value = Number(character.attributes[key]);
          if (!Number.isInteger(value) || value < 1 || value > 99) {
            errors.push(`属性 ${key.toUpperCase()} 必须是 1—99 的整数。`);
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeCharacter(input) {
  const character = clone(input);
  const timestamp = nowIso();
  character.schemaVersion = SCHEMA_VERSION;
  character.id = typeof character.id === 'string' && character.id ? character.id : createId('pc');
  character.kind = character.kind === 'npc' ? 'npc' : 'pc';
  character.name = String(character.name || '').trim();
  character.age = Math.round(toSafeNumber(character.age, 30));
  character.gender = String(character.gender || '');
  character.occupation = String(character.occupation || '');
  character.nationality = String(character.nationality || '');
  character.appearance = String(character.appearance || '');
  character.heightCm = toSafeNumber(character.heightCm, 0);
  character.weightKg = toSafeNumber(character.weightKg, 0);
  character.personality = Array.isArray(character.personality) ? character.personality.map(String) : [];
  character.catchphrase = String(character.catchphrase || '');
  character.background = String(character.background || '');
  character.joinReason = String(character.joinReason || '');
  character.importantPerson = String(character.importantPerson || '');
  character.ideology = String(character.ideology || '');
  character.significantPlace = String(character.significantPlace || '');
  character.treasuredItem = String(character.treasuredItem || '');
  character.traits = String(character.traits || '');
  character.phobias = String(character.phobias || '');
  character.motherTongue = String(character.motherTongue || '');
  character.languages = Array.isArray(character.languages)
    ? character.languages.map((item) => ({
        name: String(item?.name || ''),
        level: Math.round(toSafeNumber(item?.level, 0)),
      }))
    : [];
  character.possessions = Array.isArray(character.possessions)
    ? character.possessions.map(String)
    : [];
  character.attributes = {
    str: Math.round(toSafeNumber(character.attributes?.str, 50)),
    con: Math.round(toSafeNumber(character.attributes?.con, 50)),
    siz: Math.round(toSafeNumber(character.attributes?.siz, 50)),
    dex: Math.round(toSafeNumber(character.attributes?.dex, 50)),
    app: Math.round(toSafeNumber(character.attributes?.app, 50)),
    int: Math.round(toSafeNumber(character.attributes?.int, 50)),
    pow: Math.round(toSafeNumber(character.attributes?.pow, 50)),
    edu: Math.round(toSafeNumber(character.attributes?.edu, 50)),
  };
  character.luck = Math.round(toSafeNumber(character.luck, 50));
  character.derived = character.derived && isPlainObject(character.derived) ? character.derived : {};
  character.skills = Array.isArray(character.skills)
    ? character.skills.map((skill) => ({
        name: String(skill?.name || ''),
        base: Math.round(toSafeNumber(skill?.base, 0)),
        occupation: Math.round(toSafeNumber(skill?.occupation, 0)),
        interest: Math.round(toSafeNumber(skill?.interest, 0)),
        total: Math.round(toSafeNumber(skill?.total, 0)),
        checked: Boolean(skill?.checked),
      }))
    : [];
  character.creditRating = Math.round(toSafeNumber(character.creditRating, 0));
  character.occupationPoints = Math.round(toSafeNumber(character.occupationPoints, 0));
  character.interestPoints = Math.round(toSafeNumber(character.interestPoints, 0));
  character.notes = String(character.notes || '');
  character.portrait = character.portrait || null;
  character.createdAt = normalizeDate(character.createdAt, timestamp);
  character.updatedAt = normalizeDate(character.updatedAt, timestamp);
  return character;
}

export function listCharacters({ kind = null } = {}) {
  const { items } = readCharacterContainer();
  let list = Object.values(items).filter(isPlainObject).map(normalizeCharacter);
  if (kind) list = list.filter((character) => character.kind === kind);
  return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getCharacter(id) {
  if (typeof id !== 'string' || !id) return null;
  const { items } = readCharacterContainer();
  const character = items[id];
  return isPlainObject(character) ? normalizeCharacter(character) : null;
}

export function getCharacterCount() {
  return Object.keys(readCharacterContainer().items).length;
}

export function saveCharacter(input) {
  const check = validateCharacterBasic(input);
  if (!check.valid) {
    throw new StorageError(`角色数据不完整：${check.errors.join(' ')}`, { code: 'INVALID_CHARACTER' });
  }
  const container = readCharacterContainer();
  const existing = input.id ? container.items[input.id] : null;
  const character = normalizeCharacter({
    ...input,
    id: existing?.id || input.id || createId('pc'),
    createdAt: existing?.createdAt || input.createdAt,
    updatedAt: nowIso(),
  });
  container.items[character.id] = character;
  writeCharacterContainer(container);
  return character;
}

export function deleteCharacter(id) {
  const container = readCharacterContainer();
  if (!container.items[id]) return false;
  delete container.items[id];
  writeCharacterContainer(container);
  return true;
}

export function exportCharacterJSON(id) {
  const character = getCharacter(id);
  if (!character) throw new StorageError('找不到要导出的角色。', { code: 'CHARACTER_NOT_FOUND' });
  return JSON.stringify(
    {
      format: 'cthulhu-table.character',
      version: SCHEMA_VERSION,
      exportedAt: nowIso(),
      character,
    },
    null,
    2
  );
}

export function parseCharacterJSON(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : clone(text);
  } catch (error) {
    throw new StorageError('角色文件不是有效的 JSON。', {
      code: 'INVALID_CHARACTER_JSON',
      cause: error,
    });
  }
  const candidate =
    parsed?.format === 'cthulhu-table.character' && parsed?.character
      ? parsed.character
      : parsed?.character || parsed;
  const check = validateCharacterBasic(candidate);
  if (!check.valid) {
    throw new StorageError(`角色文件校验失败：${check.errors.join(' ')}`, {
      code: 'INVALID_CHARACTER',
    });
  }
  return normalizeCharacter(candidate);
}

/** 导入时默认生成新 id，避免覆盖同名/同 id 的已有角色。 */
export function importCharacterJSON(text, { keepId = false } = {}) {
  const parsed = parseCharacterJSON(text);
  const character = {
    ...parsed,
    id: keepId ? parsed.id : createId('pc'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return saveCharacter(character);
}

/* =========================================================
 * IndexedDB 基础封装
 * ========================================================= */

let dbPromise = null;

function wrapIdbError(message, error) {
  return new StorageError(message, { code: 'INDEXEDDB_ERROR', cause: error });
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(
      new StorageError('当前浏览器不支持 IndexedDB，模组和聊天记录将无法持久化。', {
        code: 'INDEXEDDB_UNAVAILABLE',
      })
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(wrapIdbError('无法打开 IndexedDB。', error));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORES.modules)) {
        const store = db.createObjectStore(DB_STORES.modules, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.chats)) {
        const store = db.createObjectStore(DB_STORES.chats, { keyPath: 'id' });
        store.createIndex('campaignId', 'campaignId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.saves)) {
        const store = db.createObjectStore(DB_STORES.saves, { keyPath: 'id' });
        store.createIndex('campaignId', 'campaignId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.apiLogs)) {
        const store = db.createObjectStore(DB_STORES.apiLogs, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.meta)) {
        db.createObjectStore(DB_STORES.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(wrapIdbError('打开 IndexedDB 失败。', request.error));
    request.onblocked = () =>
      reject(
        new StorageError('IndexedDB 升级被其他标签页阻塞，请关闭其他 Cthulhu Table 页面后重试。', {
          code: 'INDEXEDDB_BLOCKED',
        })
      );
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/**
 * 在单个事务中执行操作，事务完成后返回 request 的 result。
 * 注意：不要在 operation 中 await，否则事务会自动提交。
 */
function runTransaction(storeName, mode, operation) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let request = null;
        let result;
        let transaction;
        try {
          transaction = db.transaction(storeName, mode);
          request = operation(transaction.objectStore(storeName));
          if (request && 'onsuccess' in request) {
            request.onsuccess = () => {
              result = request.result;
            };
          }
        } catch (error) {
          reject(wrapIdbError('IndexedDB 操作失败。', error));
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(wrapIdbError('IndexedDB 事务失败。', transaction.error));
        transaction.onabort = () =>
          reject(
            wrapIdbError('IndexedDB 事务被中止。', transaction.error || new Error('Transaction aborted'))
          );
      })
  );
}

function dbGet(storeName, key) {
  return runTransaction(storeName, 'readonly', (store) => store.get(key));
}

function dbGetAll(storeName) {
  return runTransaction(storeName, 'readonly', (store) => store.getAll());
}

function dbCount(storeName) {
  return runTransaction(storeName, 'readonly', (store) => store.count());
}

function dbPut(storeName, value) {
  return runTransaction(storeName, 'readwrite', (store) => store.put(value));
}

function dbDelete(storeName, key) {
  return runTransaction(storeName, 'readwrite', (store) => store.delete(key));
}

function dbClear(storeName) {
  return runTransaction(storeName, 'readwrite', (store) => store.clear());
}

function dbGetAllByIndex(storeName, indexName, value) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let result = [];
        let transaction;
        try {
          transaction = db.transaction(storeName, 'readonly');
          const request = transaction.objectStore(storeName).index(indexName).getAll(value);
          request.onsuccess = () => {
            result = request.result || [];
          };
        } catch (error) {
          reject(wrapIdbError('IndexedDB 索引查询失败。', error));
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () =>
          reject(wrapIdbError('IndexedDB 索引事务失败。', transaction.error));
      })
  );
}

/* =========================================================
 * 模组（IndexedDB）
 * ========================================================= */

export async function listModules() {
  const list = await dbGetAll(DB_STORES.modules);
  return (list || []).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getModule(id) {
  return dbGet(DB_STORES.modules, id);
}

export async function saveModule(input) {
  if (!isPlainObject(input) || typeof input.title !== 'string' || !input.title.trim()) {
    throw new StorageError('模组必须包含标题 title。', { code: 'INVALID_MODULE' });
  }
  const timestamp = nowIso();
  const existing = input.id ? await getModule(input.id) : null;
  const module = {
    ...clone(input),
    id: existing?.id || input.id || createId('mod'),
    schemaVersion: SCHEMA_VERSION,
    title: input.title.trim(),
    createdAt: existing?.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await dbPut(DB_STORES.modules, module);
  emit('cthulhu:modules-changed', { id: module.id });
  return module;
}

export async function deleteModule(id) {
  await dbDelete(DB_STORES.modules, id);
  emit('cthulhu:modules-changed', { id });
  return true;
}

/* =========================================================
 * 聊天记录（IndexedDB）
 * ========================================================= */

export async function listChats(campaignId = null) {
  const list = campaignId
    ? await dbGetAllByIndex(DB_STORES.chats, 'campaignId', campaignId)
    : await dbGetAll(DB_STORES.chats);
  return (list || []).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getChat(id) {
  return dbGet(DB_STORES.chats, id);
}

export async function saveChat(input) {
  if (!isPlainObject(input)) {
    throw new StorageError('聊天记录必须是对象。', { code: 'INVALID_CHAT' });
  }
  const timestamp = nowIso();
  const existing = input.id ? await getChat(input.id) : null;
  const chat = {
    ...clone(input),
    id: existing?.id || input.id || createId('chat'),
    campaignId: input.campaignId || existing?.campaignId || '',
    title: String(input.title || existing?.title || '未命名记录'),
    messages: Array.isArray(input.messages) ? clone(input.messages) : existing?.messages || [],
    createdAt: existing?.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await dbPut(DB_STORES.chats, chat);
  emit('cthulhu:chats-changed', { id: chat.id, campaignId: chat.campaignId });
  return chat;
}

export async function deleteChat(id) {
  await dbDelete(DB_STORES.chats, id);
  emit('cthulhu:chats-changed', { id });
  return true;
}

/* =========================================================
 * 存档与 API 日志（IndexedDB）
 * ========================================================= */

export async function listSaves(campaignId = null) {
  const list = campaignId
    ? await dbGetAllByIndex(DB_STORES.saves, 'campaignId', campaignId)
    : await dbGetAll(DB_STORES.saves);
  return (list || []).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function getSave(id) {
  return dbGet(DB_STORES.saves, id);
}

export async function saveSave(input) {
  if (!isPlainObject(input) || !isPlainObject(input.snapshot)) {
    throw new StorageError('存档必须包含 snapshot 快照对象。', { code: 'INVALID_SAVE' });
  }
  const timestamp = nowIso();
  const record = {
    ...clone(input),
    id: input.id || createId('save'),
    name: String(input.name || '未命名存档'),
    campaignId: input.campaignId || '',
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.createdAt || timestamp,
  };
  await dbPut(DB_STORES.saves, record);
  return record;
}

export async function deleteSave(id) {
  await dbDelete(DB_STORES.saves, id);
  return true;
}

export async function addApiLog(log) {
  const record = {
    ...clone(log || {}),
    id: log?.id || createId('log'),
    createdAt: normalizeDate(log?.createdAt),
  };
  await dbPut(DB_STORES.apiLogs, record);
  return record;
}

export async function listApiLogs(limit = 100) {
  const list = await dbGetAll(DB_STORES.apiLogs);
  return (list || [])
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Number(limit) || 100));
}

export async function clearApiLogs() {
  await dbClear(DB_STORES.apiLogs);
  return true;
}

/* =========================================================
 * 诊断、备份与清空
 * ========================================================= */

export async function getStorageStats() {
  const stats = {
    localAvailable: isLocalStorageAvailable(),
    indexedDbAvailable: false,
    characters: getCharacterCount(),
    modules: 0,
    chats: 0,
    saves: 0,
    apiLogs: 0,
    usage: 0,
    quota: 0,
    usagePercent: 0,
  };

  try {
    const counts = await withTimeout(
      (async () => {
        await openDatabase();
        return Promise.all([
          dbCount(DB_STORES.modules),
          dbCount(DB_STORES.chats),
          dbCount(DB_STORES.saves),
          dbCount(DB_STORES.apiLogs),
        ]);
      })(),
      4500,
      'IndexedDB 响应超时。可能是浏览器隐私策略或存储被其他标签页占用。'
    );
    stats.indexedDbAvailable = true;
    const [modules, chats, saves, logs] = counts;
    stats.modules = modules || 0;
    stats.chats = chats || 0;
    stats.saves = saves || 0;
    stats.apiLogs = logs || 0;
  } catch (error) {
    console.warn('[Cthulhu Table] IndexedDB 统计失败：', error);
  }

  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await withTimeout(
        navigator.storage.estimate(),
        2000,
        '浏览器配额查询超时。'
      );
      stats.usage = estimate.usage || 0;
      stats.quota = estimate.quota || 0;
      stats.usagePercent =
        stats.quota > 0 ? Math.min(100, (stats.usage / stats.quota) * 100) : 0;
    } catch {
      // 部分浏览器在 file:// 或隐私窗口下会拒绝 estimate，不影响使用。
    }
  }

  return stats;
}

export async function runStorageSelfTest() {
  const startedAt = performance.now();
  const result = {
    ok: true,
    localStorage: false,
    indexedDb: false,
    latencyMs: 0,
    errors: [],
  };

  const probeKey = `${LS_PREFIX}:__selftest__`;
  try {
    window.localStorage.setItem(probeKey, 'ok');
    const value = window.localStorage.getItem(probeKey);
    window.localStorage.removeItem(probeKey);
    result.localStorage = value === 'ok';
    if (!result.localStorage) result.errors.push('localStorage 写入后无法读回。');
  } catch (error) {
    result.errors.push(`localStorage 不可用：${error.message}`);
  }

  try {
    await withTimeout(
      (async () => {
        await openDatabase();
        await dbPut(DB_STORES.meta, { key: '__selftest__', value: 'ok', at: nowIso() });
        const record = await dbGet(DB_STORES.meta, '__selftest__');
        await dbDelete(DB_STORES.meta, '__selftest__');
        return record;
      })(),
      5000,
      'IndexedDB 响应超时。'
    ).then((record) => {
      result.indexedDb = record?.value === 'ok';
    });
    if (!result.indexedDb) result.errors.push('IndexedDB 写入后无法读回。');
  } catch (error) {
    result.errors.push(`IndexedDB 不可用：${error.message}`);
  }

  result.ok = result.localStorage && result.indexedDb;
  result.latencyMs = Math.round(performance.now() - startedAt);
  return result;
}

export async function exportBackup() {
  const [modules, chats, saves] = await Promise.all([
    listModules().catch(() => []),
    listChats().catch(() => []),
    listSaves().catch(() => []),
  ]);
  return {
    format: 'cthulhu-table.backup',
    version: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    settings: getSettings(),
    characters: listCharacters(),
    modules,
    chats,
    saves,
  };
}

/**
 * 清空全部本地数据。阶段六会把它接到“输入确认文本”的危险操作界面；
 * 当前作为底层能力保留，任何 UI 调用前都必须二次确认。
 */
export async function clearAllData({ includeSettings = true } = {}) {
  if (includeSettings) {
    removeRaw(STORAGE_KEYS.settings);
    removeRaw(STORAGE_KEYS.ui);
  }
  removeRaw(STORAGE_KEYS.characters);
  try {
    await openDatabase();
    await Promise.all(Object.values(DB_STORES).map((storeName) => dbClear(storeName)));
  } catch (error) {
    console.warn('[Cthulhu Table] 清空 IndexedDB 失败：', error);
  }
  emit('cthulhu:characters-changed', { count: 0 });
  emit('cthulhu:modules-changed', {});
  emit('cthulhu:chats-changed', {});
  return true;
}

/* =========================================================
 * 对外聚合 API（页面只依赖这个对象，便于测试和替换）
 * ========================================================= */

export const storage = Object.freeze({
  settings: {
    get: getSettings,
    save: saveSettings,
    update: updateSettings,
    set: setSetting,
    getActiveApiProfile,
  },
  characters: {
    list: listCharacters,
    get: getCharacter,
    count: getCharacterCount,
    save: saveCharacter,
    remove: deleteCharacter,
    exportJSON: exportCharacterJSON,
    importJSON: importCharacterJSON,
    parseJSON: parseCharacterJSON,
    validate: validateCharacterBasic,
  },
  modules: {
    list: listModules,
    get: getModule,
    save: saveModule,
    remove: deleteModule,
  },
  chats: {
    list: listChats,
    get: getChat,
    save: saveChat,
    remove: deleteChat,
  },
  saves: {
    list: listSaves,
    get: getSave,
    save: saveSave,
    remove: deleteSave,
  },
  logs: {
    add: addApiLog,
    list: listApiLogs,
    clear: clearApiLogs,
  },
  diagnostics: {
    stats: getStorageStats,
    selfTest: runStorageSelfTest,
    isLocalStorageAvailable,
  },
  backup: {
    export: exportBackup,
  },
  clearAll: clearAllData,
});

export default storage;
