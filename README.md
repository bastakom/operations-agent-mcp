# Operations Agent MCP

MCP-server for ChatGPT Agent + Blikk API.

## Vercel Environment Variables

Add these in Vercel:

```txt
BLIKK_BASE_URL=https://publicapi.blikk.com
BLIKK_APP_ID=...
BLIKK_APP_SECRET=...
```

## Test

Health endpoint:

```txt
/api/health
```

MCP endpoint:

```txt
/api/mcp
```

## MCP tools

- `health_check`
- `blikk_connection_test`
- `get_users`
- `get_projects`
- `get_time_reports`
- `get_user_day_statistics`
- `get_project_time_calculation`
