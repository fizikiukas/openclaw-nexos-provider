import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createProviderApiKeyAuthMethod } from 'openclaw/plugin-sdk/provider-auth';
import {
    NEXOS_PROVIDER_ANTHROPIC,
    NEXOS_PROVIDER_COMPLETIONS,
    buildNexosCatalog,
    buildProviderConfig,
    fetchNexosModels,
    splitByEndpoint,
    type NexosCatalogModel,
} from './nexos-models.js';

// Both providers share the NEXOS_API_KEY and the same /v1/models response, so
// cache the projected catalog per key for a short window. This keeps the two
// providers' catalog hooks from double-fetching on the same startup.
const CATALOG_TTL_MS = 60_000;
const catalogCache = new Map<string, { fetchedAt: number; models: NexosCatalogModel[] }>();

async function getNexosCatalog(apiKey: string): Promise<NexosCatalogModel[]> {
    const cached = catalogCache.get(apiKey);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return cached.models;
    }
    const models = buildNexosCatalog(await fetchNexosModels(apiKey));
    catalogCache.set(apiKey, { fetchedAt: Date.now(), models });
    return models;
}

// The Nexos key lives under the `nexos` provider auth; `nexos-anthropic` reuses
// it via providerAuthAliases. Resolve defensively (own id → canonical nexos →
// environment) so both providers work regardless of how auth was configured.
function resolveNexosApiKey(
    ctx: { resolveProviderApiKey?: (id: string) => { apiKey?: string } | undefined },
    providerId: string
): string | undefined {
    const tryResolve = (id: string): string | undefined => {
        try {
            return ctx.resolveProviderApiKey?.(id)?.apiKey;
        } catch {
            return undefined;
        }
    };
    return (
        tryResolve(providerId) ||
        tryResolve(NEXOS_PROVIDER_COMPLETIONS) ||
        process.env.NEXOS_API_KEY ||
        undefined
    );
}

function selectModels(models: NexosCatalogModel[], providerId: string): NexosCatalogModel[] {
    const { completions, anthropic } = splitByEndpoint(models);
    return providerId === NEXOS_PROVIDER_ANTHROPIC ? anthropic : completions;
}

// Build the provider config (models.providers.<id>) for one provider from the
// discovered catalog. Shared by the live and static catalog hooks. Returns null
// when there is no key or no models so live discovery stays advisory.
async function buildNexosProviderResult(
    providerId: string,
    apiKey: string | undefined
): Promise<{ provider: ReturnType<typeof buildProviderConfig> } | null> {
    if (!apiKey) {
        return null;
    }
    let models: NexosCatalogModel[];
    try {
        models = await getNexosCatalog(apiKey);
    } catch {
        return null;
    }
    const selected = selectModels(models, providerId);
    if (selected.length === 0) {
        return null;
    }
    const kind = providerId === NEXOS_PROVIDER_ANTHROPIC ? 'anthropic' : 'completions';
    return { provider: buildProviderConfig({ models: selected, apiKey, kind }) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerNexosProvider(api: any, providerId: string, label: string): void {
    api.registerProvider({
        id: providerId,
        label,
        docsPath: '/providers/nexos',
        envVars: ['NEXOS_API_KEY'],
        auth: [
            createProviderApiKeyAuthMethod({
                providerId,
                methodId: 'api-key',
                label: 'nexos.ai API key',
                hint: 'API key from your nexos.ai dashboard',
                optionKey: 'nexosApiKey',
                flagName: '--nexos-api-key',
                envVar: 'NEXOS_API_KEY',
                promptMessage: 'Enter your nexos.ai API key',
            }),
        ],
        // Live catalog: consulted at runtime (picker/refresh).
        catalog: {
            order: 'simple',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            run: async (ctx: any) => buildNexosProviderResult(providerId, resolveNexosApiKey(ctx, providerId)),
        },
        // Static catalog: consulted by the host's models.json generator to
        // materialize selectable models (this build only lets you select models
        // present in the agent's static catalog). Declared as `runtime` discovery
        // in the manifest. Resolves the key from the environment since no ctx is
        // provided here.
        staticCatalog: {
            order: 'simple',
            run: async () => buildNexosProviderResult(providerId, process.env.NEXOS_API_KEY),
        },
    });

    api.registerModelCatalogProvider({
        provider: providerId,
        kinds: ['text'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        liveCatalog: async (ctx: any) => {
            const apiKey = resolveNexosApiKey(ctx, providerId);
            if (!apiKey) {
                return null;
            }
            let models: NexosCatalogModel[];
            try {
                models = await getNexosCatalog(apiKey);
            } catch {
                return null;
            }
            return selectModels(models, providerId).map((model) => ({
                kind: 'text' as const,
                provider: providerId,
                model: model.nexosModelId,
                label: model.alias,
                source: 'live' as const,
            }));
        },
    });
}

export default definePluginEntry({
    id: 'nexos',
    name: 'nexos.ai',
    description:
        'nexos.ai unified gateway — access Claude, GPT, Gemini, Grok and 60+ models through one API key.',
    register(api) {
        registerNexosProvider(api, NEXOS_PROVIDER_COMPLETIONS, 'nexos.ai');
        registerNexosProvider(api, NEXOS_PROVIDER_ANTHROPIC, 'nexos.ai (Claude)');
    },
});
