# openclaw-nexos-provider

An [OpenClaw](https://openclaw.ai) provider plugin for [nexos.ai](https://nexos.ai) —
a unified AI gateway that exposes Claude, GPT, Gemini, Grok, and 60+ other models
through a single API endpoint and one API key.

The plugin registers two providers backed by the same `NEXOS_API_KEY`:

| Provider          | Transport                       | Used for                                              |
| ----------------- | ------------------------------- | ----------------------------------------------------- |
| `nexos`           | `openai-completions` (`/v1/chat/completions`) | Every model that does not advertise the Anthropic `messages` endpoint |
| `nexos-anthropic` | `anthropic-messages` (`/v1/messages`)         | Claude models that advertise `messages` (native tool_use, caching)    |

Models are **discovered dynamically** from the Nexos `/v1/models` API at runtime,
so the catalog always reflects what your account can access — there is no
hard-coded model list to keep in sync.

## Install

```bash
openclaw plugins install clawhub:openclaw-nexos-provider
# or from npm during the launch cutover:
openclaw plugins install openclaw-nexos-provider
```

## Configure

Set your Nexos API key (either works):

```bash
export NEXOS_API_KEY="your-nexos-key"
# or, interactively:
openclaw onboard --nexos-api-key "your-nexos-key"
```

Then pick a model:

```bash
openclaw models list --provider nexos
openclaw models list --provider nexos-anthropic
openclaw agent --model "nexos/<model-id>" --message "hello"
```

Model definitions (context window, max output tokens, transport) are supplied by
the plugin; OpenClaw's catalog machinery marks the models available and shows
them in the model picker like any first-class provider.

## Develop

```bash
npm install
npm run typecheck   # requires the openclaw peer dependency
npm run test        # pure catalog/discovery unit tests (no OpenClaw runtime)
npm run build       # bundles src/index.ts -> dist/index.js (openclaw externalized)
```

- `src/nexos-models.ts` — pure, dependency-free catalog logic (fetch, project,
  split by endpoint, build provider config). Fully unit-tested.
- `src/index.ts` — the plugin entry: registers the two providers and their model
  catalogs against the OpenClaw Plugin SDK.

## Status

Community/open-source plugin. Built to follow the OpenClaw maintainers' guidance
that optional gateway/provider integrations ship as ClawHub/npm plugins rather
than in core (see openclaw/openclaw#44963). Intended to be transferable to Nexos
AI for long-term maintenance.

## License

MIT
