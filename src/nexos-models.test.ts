import { describe, it, expect, vi } from 'vitest';
import {
    NEXOS_BASE_URL,
    beautifyName,
    buildNexosCatalog,
    buildProviderConfig,
    fetchNexosModels,
    prioritizeModel,
    splitByEndpoint,
    type NexosCatalogModel,
} from './nexos-models.js';

const apiPayload = {
    data: [
        {
            id: 'model-claude',
            name: 'claude-opus-4-6',
            nexos_model_id: 'uuid-claude',
            endpoints: ['chat_completions', 'messages'],
        },
        {
            id: 'model-gpt',
            name: 'gpt-5.2',
            nexos_model_id: 'uuid-gpt',
            endpoints: ['chat_completions'],
        },
        {
            id: 'model-grok',
            name: 'grok-4',
            nexos_model_id: 'uuid-grok',
            endpoints: ['chat_completions'],
        },
    ],
};

describe('beautifyName', () => {
    it('title-cases and replaces separators', () => {
        expect(beautifyName('claude-opus-4-6')).toBe('Claude Opus 4 6');
        expect(beautifyName('gpt-5.2')).toBe('Gpt 5 2');
        expect(beautifyName('provider@model')).toBe('Provider @ Model');
    });
});

describe('prioritizeModel', () => {
    it('ranks GPT-5 highest, then by prefix', () => {
        expect(prioritizeModel('gpt-5.2')).toBe(100);
        expect(prioritizeModel('gpt-4.1')).toBe(200);
        expect(prioritizeModel('gemini-3')).toBe(300);
        expect(prioritizeModel('claude-opus-4-6')).toBe(400);
        expect(prioritizeModel('grok-4')).toBe(600);
        expect(prioritizeModel('something-unknown')).toBe(200);
    });
});

describe('buildNexosCatalog', () => {
    it('projects models with beautified aliases and required definition fields', () => {
        const catalog = buildNexosCatalog(apiPayload);
        const gpt = catalog.find((m) => m.nexosModelId === 'uuid-gpt');
        expect(gpt).toBeDefined();
        expect(gpt!.alias).toBe('Nexos Gpt 5 2');
        expect(gpt!.definition.id).toBe('uuid-gpt');
        expect(gpt!.definition.name).toBe('Nexos Gpt 5 2');
        expect(gpt!.definition.maxTokens).toBeGreaterThan(0);
        expect(gpt!.definition.contextWindow).toBeGreaterThan(0);
    });

    it('sorts by priority (GPT-5 first)', () => {
        const catalog = buildNexosCatalog(apiPayload);
        expect(catalog[0].nexosModelId).toBe('uuid-gpt');
    });

    it('defaults endpoints and skips entries missing id/name', () => {
        const catalog = buildNexosCatalog({
            data: [
                { name: 'gpt-5.2', nexos_model_id: 'uuid-a' },
                { name: 'no-id' },
                { nexos_model_id: 'no-name' },
            ],
        });
        expect(catalog).toHaveLength(1);
        expect(catalog[0].endpoints).toEqual(['chat_completions']);
    });

    it('returns [] for malformed payloads', () => {
        expect(buildNexosCatalog(null)).toEqual([]);
        expect(buildNexosCatalog({})).toEqual([]);
        expect(buildNexosCatalog({ data: 'nope' })).toEqual([]);
    });
});

describe('splitByEndpoint', () => {
    it('routes messages-capable models to anthropic, rest to completions', () => {
        const { completions, anthropic } = splitByEndpoint(buildNexosCatalog(apiPayload));
        expect(anthropic.map((m) => m.nexosModelId)).toEqual(['uuid-claude']);
        expect(completions.map((m) => m.nexosModelId).sort()).toEqual(['uuid-gpt', 'uuid-grok']);
    });
});

describe('buildProviderConfig', () => {
    const models = buildNexosCatalog(apiPayload);

    it('builds the openai-completions provider', () => {
        const cfg = buildProviderConfig({ models, apiKey: 'k', kind: 'completions' });
        expect(cfg).toMatchObject({
            baseUrl: NEXOS_BASE_URL,
            apiKey: 'k',
            api: 'openai-completions',
            auth: 'api-key',
        });
        expect(cfg.authHeader).toBeUndefined();
        expect(cfg.models.every((m) => m.maxTokens > 0)).toBe(true);
    });

    it('builds the anthropic-messages provider with token auth header', () => {
        const cfg = buildProviderConfig({ models, apiKey: 'k', kind: 'anthropic' });
        expect(cfg).toMatchObject({
            api: 'anthropic-messages',
            auth: 'token',
            authHeader: true,
        });
    });
});

describe('fetchNexosModels', () => {
    it('sends a Bearer token and returns parsed JSON', async () => {
        const json = { data: [] };
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => json });
        const result = await fetchNexosModels('secret', fetchImpl as unknown as typeof fetch);
        expect(result).toBe(json);
        expect(fetchImpl).toHaveBeenCalledWith(`${NEXOS_BASE_URL}/models`, {
            headers: { Authorization: 'Bearer secret' },
        });
    });

    it('throws on a non-ok response', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValue({ ok: false, status: 402, statusText: 'Payment Required' });
        await expect(
            fetchNexosModels('secret', fetchImpl as unknown as typeof fetch)
        ).rejects.toThrow(/402/);
    });
});

// Type-level sanity: catalog rows carry everything the plugin entry needs.
const _sample: NexosCatalogModel | undefined = buildNexosCatalog(apiPayload)[0];
void _sample;
