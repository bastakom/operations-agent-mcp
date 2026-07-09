import { assertBlikkConfig } from "../config";
import type { BlikkTokenResponse } from "./types";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function parseBlikkExpires(value?: string): number {
  if (!value) return Date.now() + 20 * 60 * 1000;

  const normalized = value.replace(" ", "T");
  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    return Date.now() + 20 * 60 * 1000;
  }

  return timestamp;
}

export async function getBlikkAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.accessToken;
  }

  const { blikkBaseUrl, blikkAppId, blikkAppSecret } = assertBlikkConfig();
  const basic = Buffer.from(`${blikkAppId}:${blikkAppSecret}`).toString("base64");

  const response = await fetch(`${blikkBaseUrl}/v1/Auth/Token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Blikk auth misslyckades (${response.status}). Svar från Blikk: ${bodyText || "tomt svar"}`
    );
  }

  const data = JSON.parse(bodyText) as BlikkTokenResponse;

  if (!data.accessToken) {
    throw new Error("Blikk auth gav inget accessToken tillbaka.");
  }

  cachedToken = {
    accessToken: data.accessToken,
    expiresAt: parseBlikkExpires(data.expires),
  };

  return data.accessToken;
}
