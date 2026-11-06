/**
 * model-catalog.js — 模型发现结果的服务商归组与参考价格目录
 *
 * 说明：
 * - /models 接口通常只返回模型 id，不返回官方价格；
 * - 本文件维护一份“参考价格”目录（USD / 1M tokens），用于在模型选择器中
 *   按服务商分组，并在同一服务商内按 输入价 + 输出价 从低到高排序；
 * - 如果接口返回了 pricing（例如 OpenRouter），优先使用接口数据；
 * - 价格会变动，UI 必须标注“参考价”。未知价格的模型排在已知价格之后。
 */

export const PROVIDER_META = Object.freeze({
  deepseek: { label: 'DeepSeek', order: 10 },
  openai: { label: 'OpenAI', order: 20 },
  anthropic: { label: 'Anthropic', order: 30 },
  google: { label: 'Google Gemini', order: 40 },
  qwen: { label: '通义千问 / Qwen', order: 50 },
  'meta-llama': { label: 'Meta Llama', order: 60 },
  mistralai: { label: 'Mistral AI', order: 70 },
  moonshotai: { label: 'Moonshot', order: 80 },
  siliconflow: { label: '硅基流动', order: 90 },
  openrouter: { label: 'OpenRouter', order: 100 },
  custom: { label: '其他 / 自定义', order: 999 },
});

/**
 * 参考价格目录：input/output 单位为 USD / 1M tokens。
 * 仅用于排序与参考，不是账单依据；以服务商控制台为准。
 */
export const MODEL_PRICE_CATALOG = Object.freeze([
  // DeepSeek
  { provider: 'deepseek', match: ['deepseek-chat'], input: 0.27, output: 1.1 },
  { provider: 'deepseek', match: ['deepseek-reasoner'], input: 0.55, output: 2.19 },

  // OpenAI
  { provider: 'openai', match: ['gpt-4.1-nano'], input: 0.1, output: 0.4 },
  { provider: 'openai', match: ['gpt-4o-mini'], input: 0.15, output: 0.6 },
  { provider: 'openai', match: ['gpt-4.1-mini'], input: 0.4, output: 1.6 },
  { provider: 'openai', match: ['o4-mini'], input: 1.1, output: 4.4 },
  { provider: 'openai', match: ['o3-mini'], input: 1.1, output: 4.4 },
  { provider: 'openai', match: ['gpt-4.1'], input: 2, output: 8 },
  { provider: 'openai', match: ['gpt-4o'], input: 2.5, output: 10 },

  // Anthropic
  { provider: 'anthropic', match: ['claude-3-haiku'], input: 0.25, output: 1.25 },
  { provider: 'anthropic', match: ['claude-3.5-haiku'], input: 0.8, output: 4 },
  { provider: 'anthropic', match: ['claude-3.5-sonnet'], input: 3, output: 15 },
  { provider: 'anthropic', match: ['claude-3.7-sonnet'], input: 3, output: 15 },
  { provider: 'anthropic', match: ['claude-sonnet-4'], input: 3, output: 15 },
  { provider: 'anthropic', match: ['claude-opus-4'], input: 15, output: 75 },

  // Google
  { provider: 'google', match: ['gemini-2.0-flash'], input: 0.1, output: 0.4 },
  { provider: 'google', match: ['gemini-2.5-flash'], input: 0.3, output: 2.5 },
  { provider: 'google', match: ['gemini-2.5-pro'], input: 1.25, output: 10 },

  // 常见开源模型（经中转/聚合平台）
  { provider: 'qwen', match: ['qwen2.5-72b', 'qwen-2.5-72b'], input: 0.59, output: 0.59 },
  { provider: 'qwen', match: ['qwen2.5-32b', 'qwen-2.5-32b'], input: 0.28, output: 0.28 },
  { provider: 'meta-llama', match: ['llama-3.3-70b'], input: 0.59, output: 0.79 },
  { provider: 'meta-llama', match: ['llama-3.1-8b'], input: 0.05, output: 0.08 },
  { provider: 'mistralai', match: ['mistral-small'], input: 0.1, output: 0.3 },
  { provider: 'mistralai', match: ['mistral-large'], input: 2, output: 6 },

  // SiliconFlow / 国内常见模型（近似 USD 参考）
  { provider: 'siliconflow', match: ['deepseek-ai/deepseek-v3', 'deepseek-v3'], input: 0.27, output: 1.1 },
  { provider: 'siliconflow', match: ['deepseek-ai/deepseek-r1', 'deepseek-r1'], input: 0.55, output: 2.19 },
]);

export const PRICE_NOTE = '参考价（USD / 1M tokens，输入 + 输出合计排序）。价格会变动，以服务商控制台为准。';

export function providerFromBaseUrl(baseUrl) {
  const value = String(baseUrl || '').toLowerCase();
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('openrouter')) return 'openrouter';
  if (value.includes('siliconflow')) return 'siliconflow';
  if (value.includes('anthropic')) return 'anthropic';
  if (value.includes('generativelanguage') || value.includes('google')) return 'google';
  if (value.includes('moonshot')) return 'moonshotai';
  if (value.includes('openai')) return 'openai';
  return 'custom';
}

const MODEL_PREFIX_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'qwen',
  'meta-llama',
  'mistralai',
  'moonshotai',
  'siliconflow',
]);

export function providerFromModelId(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('/')) {
    const prefix = id.split('/')[0];
    return MODEL_PREFIX_PROVIDERS.has(prefix) ? prefix : null;
  }
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('gemini')) return 'google';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
    return 'openai';
  }
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('llama')) return 'meta-llama';
  if (id.includes('mistral')) return 'mistralai';
  return null;
}

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 优先读取 /models 返回的 pricing；不同聚合平台字段不同。
 * 统一转换为 USD / 1M tokens。
 */
function priceFromModelRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const pricing = record.pricing;
  if (pricing && typeof pricing === 'object') {
    const prompt = numberFrom(pricing.prompt ?? pricing.input ?? pricing.input_per_token);
    const completion = numberFrom(pricing.completion ?? pricing.output ?? pricing.output_per_token);
    if (prompt !== null || completion !== null) {
      // OpenRouter 通常以 per-token 字符串返回；大于 0.01 时视为已是 per-1M。
      const factor = Math.max(prompt ?? 0, completion ?? 0) <= 0.01 ? 1_000_000 : 1;
      return {
        input: prompt === null ? null : Number((prompt * factor).toFixed(4)),
        output: completion === null ? null : Number((completion * factor).toFixed(4)),
        source: 'api',
      };
    }
  }
  return null;
}

function priceFromCatalog(provider, modelId) {
  const id = String(modelId || '').toLowerCase();
  const exactProvider = MODEL_PRICE_CATALOG.filter((entry) => entry.provider === provider);
  const anyProvider = MODEL_PRICE_CATALOG;
  for (const list of [exactProvider, anyProvider]) {
    for (const entry of list) {
      if (entry.match.some((term) => id.includes(term.toLowerCase()))) {
        return { input: entry.input, output: entry.output, source: 'catalog' };
      }
    }
  }
  return null;
}

export function resolveModelPrice(provider, modelId, record = null) {
  return priceFromModelRecord(record) || priceFromCatalog(provider, modelId);
}

export function modelTotalPrice(model) {
  const price = model?.price;
  if (!price) return Number.POSITIVE_INFINITY;
  const input = Number.isFinite(price.input) ? price.input : Number.POSITIVE_INFINITY;
  const output = Number.isFinite(price.output) ? price.output : Number.POSITIVE_INFINITY;
  const total = input + output;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

/**
 * 把 /models 返回的模型按提供商分组，并在组内按参考总价升序。
 * @param {Array} models [{id, name, owned_by, pricing}]
 * @param {{fallbackProvider?: string, baseUrl?: string}} options
 */
export function groupModels(models, { fallbackProvider = 'custom', baseUrl = '' } = {}) {
  const fallback = fallbackProvider || providerFromBaseUrl(baseUrl);
  const groups = new Map();

  for (const raw of Array.isArray(models) ? models : []) {
    const id = String(raw?.id || raw?.name || '').trim();
    if (!id) continue;
    const provider = providerFromModelId(id) || fallback || 'custom';
    const price = resolveModelPrice(provider, id, raw);
    const model = {
      id,
      name: String(raw?.name || id),
      provider,
      ownedBy: raw?.owned_by || raw?.ownedBy || '',
      price,
      raw,
    };
    if (!groups.has(provider)) {
      const meta = PROVIDER_META[provider] || PROVIDER_META.custom;
      groups.set(provider, {
        provider,
        label: meta.label,
        order: meta.order,
        models: [],
      });
    }
    groups.get(provider).models.push(model);
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.models.sort((a, b) => {
      const totalA = modelTotalPrice(a);
      const totalB = modelTotalPrice(b);
      if (totalA !== totalB) return totalA - totalB;
      return a.id.localeCompare(b.id);
    });
  }
  result.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return result;
}

export function formatPrice(price) {
  if (!price) return '价格未知';
  const input = Number.isFinite(price.input) ? `$${price.input}` : '?';
  const output = Number.isFinite(price.output) ? `$${price.output}` : '?';
  return `输入 ${input} · 输出 ${output}`;
}

export const modelCatalog = Object.freeze({
  PROVIDER_META,
  MODEL_PRICE_CATALOG,
  PRICE_NOTE,
  providerFromBaseUrl,
  providerFromModelId,
  resolveModelPrice,
  modelTotalPrice,
  groupModels,
  formatPrice,
});

export default modelCatalog;
