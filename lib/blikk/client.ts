import { getBlikkAccessToken } from "./auth";
import { getBlikkConfig } from "./config";

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

type PagedResponseSummary = {
  objectName?: string;
  page?: number;
  pageSize?: number;
  itemCount?: number;
  totalItemCount?: number;
  totalPages?: number;
  items?: unknown[];
};

function buildUrl(path: string, query?: QueryParams): string {
  console.log("➡️ buildUrl()");

  const config = getBlikkConfig();
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    config.baseUrl
  );

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  console.log("🌍 Blikk URL:", url.toString());

  return url.toString();
}

function describeValueStructure(
  value: unknown,
  depth = 0
): unknown {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (depth >= 6) {
    if (Array.isArray(value)) {
      return "array";
    }

    return typeof value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }

    return [
      describeValueStructure(value[0], depth + 1),
    ];
  }

  if (typeof value === "object") {
    const structure: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      structure[key] = describeValueStructure(
        nestedValue,
        depth + 1
      );
    }

    return structure;
  }

  return typeof value;
}

function logResponseBody(
  text: string,
  path: string
): void {
  if (!text) {
    console.log("ℹ️ Empty response body");
    return;
  }

  try {
    const parsed = JSON.parse(text) as PagedResponseSummary;

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.page === "number" &&
      typeof parsed.totalPages === "number"
    ) {
      console.log("📄 Paginated response summary:", {
        objectName: parsed.objectName,
        page: parsed.page,
        pageSize: parsed.pageSize,
        itemCount: parsed.itemCount,
        totalItemCount: parsed.totalItemCount,
        totalPages: parsed.totalPages,
      });

      const isTimeReportPath = path
        .toLowerCase()
        .endsWith("/timereports");

      if (isTimeReportPath) {
        console.log(
          "TIME_REPORT_DEBUG:",
          JSON.stringify({
            path,
            hasItemsArray: Array.isArray(parsed.items),
            numberOfItems: Array.isArray(parsed.items)
              ? parsed.items.length
              : null,
          })
        );
      }

      if (
        isTimeReportPath &&
        Array.isArray(parsed.items) &&
        parsed.items.length > 0
      ) {
        const structure = describeValueStructure(
          parsed.items[0]
        );

        console.log(
          `TIME_REPORT_STRUCTURE=${JSON.stringify(structure)}`
        );
      }

      return;
    }
  } catch {
    // The normal JSON validation below handles invalid JSON.
  }

  if (text.length <= 2000) {
    console.log("📄 Response body:", text);
    return;
  }

  console.log("📄 Large response body omitted from logs:", {
    characterCount: text.length,
    preview: `${text.slice(0, 500)}...`,
  });
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

  if (!response.ok) {
    console.error("❌ Blikk request failed");
    console.error("📄 Error response body:", text);

    throw new Error(
      `Blikk GET ${path} failed (${response.status}): ${text}`
    );
  }

  logResponseBody(text, path);

  if (!text) {
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
