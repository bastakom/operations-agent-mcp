import { getBlikkConfig } from "./config";

type TokenResponse = {
  access_token?: string;
  accessToken?: string;
  token?: string;
  expires_in?: number;
  expiresIn?: number;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getBlikkAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const config = getBlikkConfig();
  const auth = Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64");

  const response = await fetch(`${config.baseUrl}/v1/Auth/Token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Blikk auth failed (${response.status}): ${text}`);
  }

  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Blikk auth returned invalid JSON: ${text}`);
  }

  const token = json.access_token || json.accessToken || json.token;
  if (!token) {
    throw new Error(`Blikk auth response did not contain token. Response: ${text}`);
  }

  const expiresInSeconds = json.expires_in || json.expiresIn || 3600;
  cachedToken = {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  return token;
}
