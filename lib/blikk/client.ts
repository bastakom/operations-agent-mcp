import { getBlikkAccessToken } from "./auth";
import { getBlikkConfig } from "./config";

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: QueryParams): string {
  const config = getBlikkConfig();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, config.baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

export async function blikkGet<T>(path: string, query?: QueryParams): Promise<T> {
  const token = await getBlikkAccessToken();
  const url = buildUrl(path, query);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Blikk GET ${path} failed (${response.status}): ${text}`);
  }

  if (!text) return null as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Blikk GET ${path} returned invalid JSON: ${text}`);
  }
}
