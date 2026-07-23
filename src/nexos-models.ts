/**
 * Pure Nexos model catalog logic — no OpenClaw SDK imports so it can be unit
 * tested in isolation. Fetches the Nexos `/v1/models` list, projects each model
 * into an OpenClaw model definition, and splits the catalog across the two
 * providers this plugin registers:
 *
 *   - `nexos`            → OpenAI-compatible `/v1/chat/completions`
 *   - `nexos-anthropic`  → Anthropic-style `/v1/messages` (Claude models that
 *                          advertise the `messages` endpoint)
 */

export const NEXOS_BASE_URL = 'https://api.nexos.ai/v1';
export const NEXOS_PROVIDER_COMPLETIONS = 'nexos';
export const NEXOS_PROVIDER_ANTHROPIC = 'nexos-anthropic';

// Anthropic's messages transport (and OpenClaw's request builder generally)
// requires a positive maxTokens on every model definition, so materialize a
// conservative default. Nexos does not advertise per-model output limits.
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_CONTEXT_WINDOW = 200000;

/** Higher-signal ordering so the strongest models sort first (lowest number). */
const MODEL_REGEX_PRIORITIES: Record<string, number> = {
    '\\bgpt[\\s-_]5(.\\d+)?': 100,
};
const MODEL_PREFIX_PRIORITIES: Record<string, number> = {
    gpt: 200,
    gemini: 300,
    claude: 400,
    'anthropic.claude': 400,
    grok: 600,
};

/** An OpenClaw model definition (`models.providers.<id>.models[]` entry). */
export interface NexosModelDefinition {
    id: string;
    name: string;
    reasoning: boolean;
    input: string[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    maxTokens: number;
    contextWindow: number;
    compat: {
        supportsStore: boolean;
        supportsDeveloperRole: boolean;
        supportsReasoningEffort: boolean;
    };
}

export interface NexosCatalogModel {
    /** Display name, e.g. "Nexos Claude Opus 4 8". */
    alias: string;
    /** Stable Nexos model id used as the provider-scoped model id. */
    nexosModelId: string;
    /** Sort weight; lower is stronger/preferred. */
    priority: number;
    /** Endpoints the model advertises (e.g. `chat_completions`, `messages`). */
    endpoints: string[];
    definition: NexosModelDefinition;
}

/** An OpenClaw provider config (`models.providers.<id>`). */
export interface NexosProviderConfig {
    baseUrl: string;
    apiKey: string;
    api: 'openai-completions' | 'anthropic-messages';
    auth: 'api-key' | 'token';
    authHeader?: boolean;
    models: NexosModelDefinition[];
}

interface NexosApiModel {
    id?: string;
    name?: string;
    nexos_model_id?: string;
    endpoints?: unknown;
}

export function beautifyName(name: string): string {
    return name
        .replace(/-/g, ' ')
        .replace(/\./g, ' ')
        .replace(/@/g, ' @ ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function prioritizeModel(name: string): number {
    for (const [pattern, priority] of Object.entries(MODEL_REGEX_PRIORITIES)) {
        if (new RegExp(pattern, 'i').test(name)) {
            return priority;
        }
    }
    const prefix = (name.replace(' ', '-').split('-')[0] ?? '').toLowerCase();
    return MODEL_PREFIX_PRIORITIES[prefix] ?? 200;
}

/** Project the Nexos `/v1/models` payload into a sorted catalog. */
export function buildNexosCatalog(apiData: unknown): NexosCatalogModel[] {
    const data = (apiData as { data?: NexosApiModel[] } | null)?.data;
    if (!Array.isArray(data)) {
        return [];
    }

    const models: NexosCatalogModel[] = [];
    for (const model of data) {
        const nexosModelId = model.nexos_model_id;
        const rawName = model.name;
        if (!nexosModelId || !rawName) {
            continue;
        }
        const alias = `Nexos ${beautifyName(rawName)}`;
        const endpoints = Array.isArray(model.endpoints)
            ? (model.endpoints as string[])
            : ['chat_completions'];
        models.push({
            alias,
            nexosModelId,
            priority: prioritizeModel(rawName),
            endpoints,
            definition: {
                id: nexosModelId,
                name: alias,
                reasoning: true,
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                maxTokens: DEFAULT_MAX_TOKENS,
                contextWindow: DEFAULT_CONTEXT_WINDOW,
                compat: {
                    supportsStore: true,
                    supportsDeveloperRole: true,
                    supportsReasoningEffort: false,
                },
            },
        });
    }

    models.sort((a, b) => a.priority - b.priority);
    return models;
}

/**
 * Split the catalog by advertised endpoint. Models exposing `messages` are
 * routed through the Anthropic-messages adapter (it handles the Claude API
 * shape — caching, tool_use); everything else uses openai-completions.
 */
export function splitByEndpoint(models: NexosCatalogModel[]): {
    completions: NexosCatalogModel[];
    anthropic: NexosCatalogModel[];
} {
    const completions: NexosCatalogModel[] = [];
    const anthropic: NexosCatalogModel[] = [];
    for (const model of models) {
        if (model.endpoints.includes('messages')) {
            anthropic.push(model);
        } else {
            completions.push(model);
        }
    }
    return { completions, anthropic };
}

/** Build the OpenClaw provider config for one of the two Nexos providers. */
export function buildProviderConfig(params: {
    models: NexosCatalogModel[];
    apiKey: string;
    kind: 'completions' | 'anthropic';
}): NexosProviderConfig {
    const models = params.models.map((model) => model.definition);
    if (params.kind === 'anthropic') {
        return {
            baseUrl: NEXOS_BASE_URL,
            apiKey: params.apiKey,
            api: 'anthropic-messages',
            auth: 'token',
            authHeader: true,
            models,
        };
    }
    return {
        baseUrl: NEXOS_BASE_URL,
        apiKey: params.apiKey,
        api: 'openai-completions',
        auth: 'api-key',
        models,
    };
}

/** Fetch the Nexos model list. `fetchImpl` is injectable for testing. */
export async function fetchNexosModels(
    apiKey: string,
    fetchImpl: typeof fetch = fetch
): Promise<unknown> {
    const response = await fetchImpl(`${NEXOS_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
        throw new Error(
            `Nexos model list request failed: ${response.status} ${response.statusText}`
        );
    }
    return response.json();
}
