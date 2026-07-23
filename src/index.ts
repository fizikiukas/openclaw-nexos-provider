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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerNexosProvider(api: any, providerId: string, label: string): void {
    const kind = providerId === NEXOS_PROVIDER_ANTHROPIC ? 'anthropic' : 'completions';

    api.registerProvider({
        id: providerId,
        label,
        docsPath: '/providers/nexos',
        envVars: ['NEXOS_API_KEY'],
        auth: [
            createProviderApiKeyAuthMethod({
                providerId,
                methodId: 'api-key',
                label: 'Nexos AI API key',
                hint: 'API key from your Nexos AI dashboard',
                optionKey: 'nexosApiKey',
                flagName: '--nexos-api-key',
                envVar: 'NEXOS_API_KEY',
                promptMessage: 'Enter your Nexos AI API key',
            }),
        ],
        catalog: {
            order: 'simple',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            run: async (ctx: any) => {
                const apiKey = resolveNexosApiKey(ctx, providerId);
                if (!apiKey) {
                    return null;
                }
                let models: NexosCatalogModel[];
                try {
                    models = await getNexosCatalog(apiKey);
                } catch {
                    // Live discovery is advisory; a fetch failure just yields no
                    // models for this provider rather than tearing it down.
                    return null;
                }
                const selected = selectModels(models, providerId);
                if (selected.length === 0) {
                    return null;
                }
                return { provider: buildProviderConfig({ models: selected, apiKey, kind }) };
            },
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
    name: 'Nexos AI',
    description:
        'Nexos AI unified gateway — access Claude, GPT, Gemini, Grok and 60+ models through one API key.',
    register(api) {
        registerNexosProvider(api, NEXOS_PROVIDER_COMPLETIONS, 'Nexos AI');
        registerNexosProvider(api, NEXOS_PROVIDER_ANTHROPIC, 'Nexos AI (Claude)');
    },
});
