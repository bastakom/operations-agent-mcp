# Operations Agent MCP - Blikk MVP

Detta är en färdig MVP för:

**ChatGPT Agent -> MCP-server på Vercel -> Blikk API**

Den är byggd för att ge en ChatGPT Agent egna verktyg för tidsrapportering, projektbudget och veckorapportering.

## Viktigt

Version 1 skickar inga mail automatiskt. Den hämtar data och skapar rapportunderlag. Låt agenten skriva rapport och mailutkast först.

## MCP-endpoint

Efter deploy i Vercel blir MCP-endpointen:

```text
https://operations-agent-mcp.vercel.app/api/mcp
```

Om ditt projekt har annat namn använder du:

```text
https://DITT-PROJEKT.vercel.app/api/mcp
```

Startsidan `/` visar bara att servern är live.

## Miljövariabler i Vercel

Gå till:

**Vercel -> Project -> Settings -> Environment Variables**

Lägg in:

```text
BLIKK_APP_ID=din_app_id
BLIKK_APP_SECRET=din_app_secret
BLIKK_BASE_URL=https://publicapi.blikk.com
```

Valfritt senare:

```text
MCP_API_KEY=
```

I denna MVP används inte `MCP_API_KEY` aktivt. Första målet är att få MCP + Blikk att fungera. När allt är testat bör vi lägga på autentisering på MCP-servern innan produktion.

## Verktyg som agenten får

### `health_check`
Kontrollerar att MCP-servern är live.

### `blikk_connection_test`
Testar att Blikk-auth fungerar genom att hämta några användare.

### `get_users`
Hämtar användare från Blikk.

### `get_projects`
Hämtar projekt från Blikk.

### `get_time_reports`
Hämtar tidsrapporter för period och summerar per användare/projekt.

Input:

```json
{
  "start_date": "2026-07-01",
  "end_date": "2026-07-07"
}
```

### `get_missing_time_reports`
Hämtar UserDayStatistics från Blikk för att hitta saknad/bristfällig tidsrapportering.

Perioden får vara max 31 dagar.

### `get_project_budget_status`
Hämtar `TimeCalculation` för ett projekt och beräknar status.

Status:

- `green` = under 80 %
- `yellow` = 80-99,9 %
- `red` = 100 % eller mer
- `unknown` = budgettimmar kunde inte hittas i svaret

### `get_resource_planning`
Hämtar planeringssummeringar från Blikk.

Använd antingen:

```json
{ "project_id": 123, "start_date": "2026-07-01", "end_date": "2026-07-07" }
```

eller:

```json
{ "user_id": 456, "start_date": "2026-07-01", "end_date": "2026-07-07" }
```

### `get_weekly_operations_report`
Hämtar tidsrapporter, användare, projekt, budgetstatus och saknad tid för föregående vecka.

Input kan lämnas tomt:

```json
{}
```

Eller med datum:

```json
{
  "start_date": "2026-07-01",
  "end_date": "2026-07-07"
}
```

## Så deployar du

1. Töm ditt gamla GitHub-repo.
2. Ladda upp alla filer från denna ZIP i roten av repot.
3. Gå till Vercel.
4. Importera repot om det inte redan är importerat.
5. Lägg in miljövariablerna.
6. Deploya.
7. Öppna startsidan:

```text
https://operations-agent-mcp.vercel.app
```

8. Koppla MCP-endpointen i ChatGPT Agent:

```text
https://operations-agent-mcp.vercel.app/api/mcp
```

## Agentprompt

Klistra in detta i din Agent:

```text
Du är Operations Agent för tidsrapportering.

Du använder verktygen i Blikk Operations MCP för att hämta data från Blikk.

Ditt primära uppdrag är att varje vecka analysera:
- rapporterad tid per person
- rapporterad tid per projekt
- saknad eller bristfällig tidsrapportering
- projektens tidsbudget
- projekt som närmar sig eller överskrider tidsbudget

Statusnivåer:
- Grön: projektet ligger under 80 % av tidsbudget.
- Gul: projektet har passerat 80 % av tidsbudget.
- Röd: projektet har passerat 100 % av tidsbudget eller saknar korrekt rapportering.

När användaren ber om veckorapport ska du först använda verktyget get_weekly_operations_report.

Rapporten ska innehålla:
1. Kort sammanfattning
2. Projekt med högst risk
3. Projekt över 80 % av tidsbudget
4. Projekt över 100 % av tidsbudget
5. Personer som saknar eller har bristfällig tidsrapportering
6. Skillnad mellan planerad och rapporterad tid när data finns
7. Rekommenderade åtgärder för kommande vecka
8. Förslag på påminnelsemail till berörda personer

Skriv på svenska. Var kort, tydlig och konkret. Skicka inga externa mail utan uttryckligt godkännande.
```

## Felsökning

### Startsidan fungerar men `/api/mcp` visar konstigt svar
Det är normalt. MCP-endpointen är till för en MCP-klient, inte vanlig webbläsare.

### Vercel Functions är tomt
Då ligger filerna fel i GitHub. `app/api/[transport]/route.ts` måste ligga exakt där.

### Blikk auth failed
Kontrollera:

- BLIKK_APP_ID
- BLIKK_APP_SECRET
- att API-applikationen är aktiv i Blikk
- att den har rätt behörigheter

### 403 från Blikk
API-applikationen saknar behörighet eller har IP-begränsning.

### 429 från Blikk
Blikk har rate limit på 4 requests/sekund. Koden har delay på paginering, men stora rapporter kan ändå behöva delas upp.

## Nästa steg efter fungerande MVP

1. Säkerställ fältnamn från ert Blikk-konto.
2. Justera budgetfält och tidsfält om Blikk returnerar andra namn.
3. Lägg till MCP-auth.
4. Lägg till Gmail/Outlook för mailutkast.
5. Schemalägg agenten varje torsdag.
