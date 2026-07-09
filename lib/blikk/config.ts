export type BlikkConfig = {
  baseUrl: string;
  appId: string;
  appSecret: string;
};

export function getBlikkConfig(): BlikkConfig {
  const baseUrl = process.env.BLIKK_BASE_URL || "https://publicapi.blikk.com";
  const appId = process.env.BLIKK_APP_ID;
  const appSecret = process.env.BLIKK_APP_SECRET;

  const missing: string[] = [];
  if (!appId) missing.push("BLIKK_APP_ID");
  if (!appSecret) missing.push("BLIKK_APP_SECRET");

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    appId,
    appSecret,
  };
}
