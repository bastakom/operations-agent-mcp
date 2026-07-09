# Operations Agent MCP - Milestone 2

Detta är andra milstolpen för Operations Agent MCP.

Nu finns:

- Next.js på Vercel
- `/api/health`
- `/api/mcp`
- MCP tools:
  - `health_check`
  - `echo`
  - `blikk_connection_test`
  - `get_users`
  - `get_projects`
  - `get_time_reports`
- Blikk auth via App ID + App Secret
- Blikk API-klient

## Vercel Environment Variables

Lägg in dessa i Vercel:

```text
BLIKK_BASE_URL=https://publicapi.blikk.com
BLIKK_APP_ID=din_app_id
BLIKK_APP_SECRET=din_app_secret
```

## Test

Efter deploy:

```text
https://din-vercel-url.vercel.app/api/health
```

Sedan kopplar du `/api/mcp` till ChatGPT Agent och testar tool:

```text
blikk_connection_test
```

## Viktigt

Blikk API har rate limit. Kör inte stora datamängder innan vi byggt paginering och sammanställning.
