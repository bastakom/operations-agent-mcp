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

  if (!response.ok) {
    console.error("❌ Blikk authentication failed", {
      status: response.status,
    });

    throw new Error(
      `Blikk authentication failed with status ${response.status}.`
    );
  }

  let json: TokenResponse;

  try {
    json = JSON.parse(text) as TokenResponse;
    console.log("✅ Auth JSON parsed");
  } catch {
    console.error("❌ Invalid JSON from auth endpoint");

    throw new Error("Blikk authentication returned invalid JSON.");
  }

  const token = json.access_token || json.accessToken || json.token;

  if (!token) {
    console.error("❌ No access token returned");

    throw new Error(
      "Blikk authentication response did not contain an access token."
    );
  }

  const expiresInSeconds = json.expires_in || json.expiresIn || 3600;

  cachedToken = {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  console.log("✅ New access token cached");
  console.log("⏱️ Expires in:", expiresInSeconds, "seconds");

  return token;
}
