import { assertBlikkConfig, getConfig } from "./config";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeBasic(appId: string, secret: string) {
  return Buffer.from(`${appId}:${secret}`, "utf8").toString("base64");
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

function normalizeExpires(value?: string): number {
  if (!value) return Date.now() + 20 * 60 * 1000;
  const parsed = Date.parse(value.replace(" ", "T"));
  if (Number.isNaN(parsed)) return Date.now() + 20 * 60 * 1000;
  return parsed - 60 * 1000;
}

export async function getBlikkAccessToken() {
  const config = assertBlikkConfig();
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;

  const res = await fetch(`${config.blikkBaseUrl}/v1/Auth/Token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeBasic(config.blikkAppId, config.blikkAppSecret)}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Blikk auth failed (${res.status}): ${bodyText}`);
  }

  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!body.accessToken) throw new Error("Blikk auth response did not include accessToken.");
  tokenCache = { accessToken: body.accessToken, expiresAt: normalizeExpires(body.expires) };
  return tokenCache.accessToken;
}

export async function blikkRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const config = getConfig();
  const token = await getBlikkAccessToken();
  const url = `${config.blikkBaseUrl}${path}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {})
      },
      cache: "no-store"
    });

    const text = await res.text();
    if (res.status === 429 && attempt < 2) {
      const waitHeader = res.headers.get("retry-after");
      const waitMs = waitHeader ? Number(waitHeader) * 1000 : 1200;
      await sleep(Number.isFinite(waitMs) ? waitMs : 1200);
      continue;
    }

    if (!res.ok) throw new Error(`Blikk request failed ${res.status} ${path}: ${text}`);
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
  throw new Error(`Blikk request failed after retries: ${path}`);
}

export async function getPagedList<T = any>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}, maxPages = 10) {
  const all: T[] = [];
  let page = Number(params.page || 1);
  const pageSize = Number(params.pageSize || 100);

  for (let i = 0; i < maxPages; i += 1) {
    const query = buildQuery({ ...params, page, pageSize });
    const data: any = await blikkRequest(`${path}${query}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    all.push(...items);
    if (!data?.totalPages || page >= data.totalPages) break;
    page += 1;
    await sleep(300);
  }

  return all;
}
