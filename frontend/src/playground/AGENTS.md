# Playground — `frontend/src/playground/`

In-browser prompt playground. Lets operators exercise chat, generate, and embedding endpoints from the UI.

## Purpose

Operator-facing test surface for trying prompts and inspecting responses without scripting. Each panel corresponds to one of the three core inference endpoints.

## Directory Map

```
playground/
├── ChatPanel.tsx                  # chat completion playground (uses Ollama / OpenAI / Anthropic shape)
├── GeneratePanel.tsx              # generate completion playground
├── EmbedPanel.tsx                 # embeddings playground
├── HistoryPanel.tsx               # recent playground requests (for replay)
├── TokenUsageCard.tsx             # token usage summary for the active request
├── useChatStream.ts               # chat streaming hook (calls streaming endpoint)
├── useGenerateStream.ts           # generate streaming hook
├── useEmbeddings.ts               # embeddings hook
└── __tests__/                     # panel + hook tests
```

The panels are independent — no shared state beyond auth and the request history. Hooks are colocated with the panel that owns them.

## Local Contracts

- Reads the same auth context as the rest of the frontend.
- Calls go through [`../api/`](../api/) wrappers, never directly via fetch.
- Streaming responses are consumed via the `use*Stream` hooks (SSE → React state).

## Verification

```bash
cd ollama-orchestrator/frontend && npx vitest run src/playground/
```