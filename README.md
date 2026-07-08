# Operations Agent MCP

MCP-server for ChatGPT Agent, hosted on Vercel and connected to Blikk API.

## Endpoint

After deploy:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/mcp
```

Health endpoint:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/health
```

## Environment variables in Vercel

Add these in Vercel Project Settings -> Environment Variables:

```text
BLIKK_APP_ID=...
BLIKK_APP_SECRET=...
BLIKK_BASE_URL=https://publicapi.blikk.com
```

Never commit real secrets to GitHub.

## Tools included

- `health_check`
- `test_blikk_auth`
- `get_users`
- `get_projects`
- `get_time_reports`
- `get_user_day_statistics`
- `get_project_time_calculation`
- `get_planning_summaries_projects`
- `get_planning_summaries_users`
- `get_weekly_operations_data`

## First test prompt in ChatGPT Agent

```text
Kör health_check och test_blikk_auth. Säg om MCP-servern och Blikk-kopplingen fungerar.
```

## Main agent prompt

```text
Du är Operations Agent för tidsrapportering.

Använd MCP-verktyget get_weekly_operations_data för att hämta data från Blikk.

Varje rapport ska innehålla:
1. Kort sammanfattning
2. Projekt med högst tidsavvikelse
3. Projekt som passerat 80 % av tidsbudget
4. Projekt som passerat 100 % av tidsbudget
5. Personer som saknar eller har bristfällig tidsrapportering
6. Skillnad mellan planerad och rapporterad tid om datan finns
7. Rekommenderade åtgärder för kommande vecka
8. Förslag på påminnelsemail till berörda personer

Status:
- Grön: under 80 % av tidsbudget och i linje med plan
- Gul: över 80 % av tidsbudget
- Röd: över 100 % av tidsbudget eller saknad/bristfällig rapportering

Skriv på svenska, konkret och kort.
Skicka inga mail automatiskt i version 1. Skapa endast utkast/förslag.
```
