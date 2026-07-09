# Operations Agent MCP - Milestone 1

Detta är första stabila grunden för Operations Agent MCP.

## Endpoints

- `/` visar en enkel startsida.
- `/api/health` kontrollerar att appen är live.
- `/api/mcp` är MCP-endpointen för ChatGPT Agent.

## Test efter deploy

Öppna:

```text
https://operations-agent-mcp.vercel.app/api/health
```

Du ska få JSON med `status: "ok"`.
