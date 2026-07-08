export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type PagedResponse<T = JsonObject> = {
  page?: number;
  pageSize?: number;
  itemCount?: number;
  totalItemCount?: number;
  totalPages?: number;
  items?: T[];
  [key: string]: unknown;
};

export type BlikkConfig = {
  appId: string;
  appSecret: string;
  baseUrl: string;
};

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

export function getBlikkConfig(): BlikkConfig {
  const appId = process.env.BLIKK_APP_ID;
  const appSecret = process.env.BLIKK_APP_SECRET;
  const baseUrl = process.env.BLIKK_BASE_URL || "https://publicapi.blikk.com";

  if (!appId || !appSecret) {
    throw new Error("Missing BLIKK_APP_ID or BLIKK_APP_SECRET in Vercel Environment Variables.");
  }

  return { appId, appSecret, baseUrl: baseUrl.replace(/\/$/, "") };
}

function parseBlikkDateToMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalised = value.replace(" ", "T");
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : ms;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const { appId, appSecret, baseUrl } = getBlikkConfig();
  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/Auth/Token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Blikk auth failed (${response.status}): ${JSON.stringify(body).slice(0, 1000)}`);
  }

  const accessToken = body.accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(`Blikk auth response did not include accessToken: ${JSON.stringify(body).slice(0, 1000)}`);
  }

  const expiresMs = parseBlikkDateToMs(body.expires) ?? Date.now() + 50 * 60_000;
  cachedToken = { accessToken, expiresAtMs: expiresMs };
  return accessToken;
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function blikkRequest<T = unknown>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
  const { baseUrl } = getBlikkConfig();
  const token = await getAccessToken();
  const url = `${baseUrl}${path}${params ? buildQuery(params) : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") || "1";
    throw new Error(`Blikk rate limit hit. Retry after ${retryAfter} seconds. Response: ${JSON.stringify(body).slice(0, 1000)}`);
  }

  if (!response.ok) {
    throw new Error(`Blikk request failed ${response.status} for ${path}: ${JSON.stringify(body).slice(0, 1000)}`);
  }

  return body as T;
}

export async function listAllPages<T = JsonObject>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  maxPages = 20
): Promise<T[]> {
  const pageSize = Number(params.pageSize || 100);
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await blikkRequest<PagedResponse<T>>(path, { ...params, page, pageSize });
    const pageItems = Array.isArray(result.items) ? result.items : [];
    items.push(...pageItems);

    const totalPages = typeof result.totalPages === "number" ? result.totalPages : pageItems.length < pageSize ? page : page + 1;
    if (page >= totalPages || pageItems.length === 0) break;

    // Blikk rate limit is 4 requests/second. Keep a small delay between paged calls.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return items;
}

export function pickNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function pickString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

export function pickNestedNumber(obj: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    let current: unknown = obj;
    for (const key of path) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current === "string" && Number.isFinite(Number(current))) return Number(current);
  }
  return null;
}

export function formatJsonForMcp(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function previousWeekRange(referenceDate = new Date()): { startDate: string; endDate: string } {
  const date = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const day = date.getUTCDay() || 7;
  const thisMonday = new Date(date);
  thisMonday.setUTCDate(date.getUTCDate() - day + 1);
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setUTCDate(lastMonday.getUTCDate() + 6);

  return {
    startDate: lastMonday.toISOString().slice(0, 10),
    endDate: lastSunday.toISOString().slice(0, 10)
  };
}

export function budgetStatus(reportedHours: number, budgetHours: number | null): "green" | "yellow" | "red" | "unknown" {
  if (!budgetHours || budgetHours <= 0) return "unknown";
  const used = reportedHours / budgetHours;
  if (used >= 1) return "red";
  if (used >= 0.8) return "yellow";
  return "green";
}
