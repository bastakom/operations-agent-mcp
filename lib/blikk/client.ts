import { getBlikkAccessToken } from "./auth";
import { getBlikkConfig } from "./config";

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

function buildUrl(path: string, query?: QueryParams): string {
  console.log("➡️ buildUrl()");

  const config = getBlikkConfig();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, config.baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  console.log("🌍 Blikk URL:", url.toString());

  return url.toString();
}

export async function blikkGet<T>(
  path: string,
  query?: QueryParams
): Promise<T> {
  console.log("➡️ blikkGet()");
  console.log("📍 Path:", path);
  console.log("📦 Query:", query);

  console.log("🔑 Fetching access token...");
  const token = await getBlikkAccessToken();

  console.log("✅ Access token received");
  console.log("🔑 Token length:", token.length);

  const url = buildUrl(path, query);

  console.log("➡️ Sending GET request to Blikk...");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  console.log("⬅️ Response status:", response.status);

  const text = await response.text();

  console.log("📄 Response body:");
  console.log(text);

  if (!response.ok) {
    console.error("❌ Blikk request failed");

    throw new Error(`Blikk GET ${path} failed (${response.status}): ${text}`);
  }

  if (!text) {
    console.log("ℹ️ Empty response body");
    return null as T;
  }

  try {
    const json = JSON.parse(text) as T;

    console.log("✅ JSON parsed successfully");

    return json;
  } catch {
    console.error("❌ Invalid JSON returned from Blikk");

    throw new Error(
      `Blikk GET ${path} returned invalid JSON: ${text}`
    );
  }
}
