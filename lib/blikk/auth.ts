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
  console.log("➡️ getBlikkAccessToken()");

  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    console.log("✅ Using cached access token");
    return cachedToken.token;
  }

  console.log("🔧 Loading Blikk configuration");

  const config = getBlikkConfig();

  console.log("🌍 Base URL:", config.baseUrl);
  console.log("🆔 App ID:", config.appId);

  const auth = Buffer.from(
    `${config.appId}:${config.appSecret}`
  ).toString("base64");

  console.log("➡️ Requesting new access token from Blikk");

  const response = await fetch(`${config.baseUrl}/v1/Auth/Token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  console.log("⬅️ Auth response status:", response.status);

  const text = await response.text();

  console.log("📄 Auth response body:");
  console.log(text);

  if (!response.ok) {
    console.error("❌ Blikk authentication failed");

    throw new Error(`Blikk auth failed (${response.status}): ${text}`);
  }

  let json: TokenResponse;

  try {
    json = JSON.parse(text) as TokenResponse;
    console.log("✅ Auth JSON parsed");
  } catch {
    console.error("❌ Invalid JSON from auth endpoint");

    throw new Error(`Blikk auth returned invalid JSON: ${text}`);
  }

  const token = json.access_token || json.accessToken || json.token;

  if (!token) {
    console.error("❌ No access token returned");

    throw new Error(
      `Blikk auth response did not contain token. Response: ${text}`
    );
  }

  const expiresInSeconds = json.expires_in || json.expiresIn || 3600;

  cachedToken = {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  console.log("✅ New access token cached");
  console.log("🔑 Token length:", token.length);
  console.log("⏱️ Expires in:", expiresInSeconds, "seconds");

  return token;
}
