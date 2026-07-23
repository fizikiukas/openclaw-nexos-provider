---
title: "nexos.ai"
summary: "Use nexos.ai's unified gateway (Claude, GPT, Gemini, Grok, and more) in OpenClaw via one API key"
---

nexos.ai is a unified AI gateway that provides OpenAI-compatible access to models
from many providers — Anthropic, OpenAI, Google, xAI, Mistral, and more — through
a single API endpoint and API key.

This plugin registers two OpenClaw providers, both authenticated with
`NEXOS_API_KEY`:

- **`nexos`** — OpenAI-compatible `/v1/chat/completions` transport for all
  general models.
- **`nexos-anthropic`** — Anthropic-style `/v1/messages` transport for Claude
  models that advertise the `messages` endpoint (native tool_use and caching).

## Getting started

1. Get an API key from your nexos.ai dashboard.
2. Provide it to OpenClaw:

   ```bash
   openclaw onboard --nexos-api-key "$NEXOS_API_KEY"
   # or set NEXOS_API_KEY in the environment
   ```

3. Verify the models are available:

   ```bash
   openclaw models list --provider nexos
   openclaw models list --provider nexos-anthropic
   ```

## Model discovery

The plugin fetches the Nexos `/v1/models` list at runtime and projects each model
into an OpenClaw model definition, so the catalog reflects exactly what your
account can access. Models advertising the `messages` endpoint are routed through
`nexos-anthropic`; the rest through `nexos`.

## Notes

- One API key, many providers — no separate accounts/keys per model vendor.
- Cost is tracked centrally by Nexos; the plugin reports zeroed per-token cost.
- A conservative `maxTokens`/`contextWindow` default is applied because Nexos
  does not advertise per-model output limits.
