export type AppConfig = {
  blikkBaseUrl: string;
  blikkAppId?: string;
  blikkAppSecret?: string;
};

export function getConfig(): AppConfig {
  return {
    blikkBaseUrl: process.env.BLIKK_BASE_URL || "https://publicapi.blikk.com",
    blikkAppId: process.env.BLIKK_APP_ID,
    blikkAppSecret: process.env.BLIKK_APP_SECRET
  };
}

export function assertBlikkConfig() {
  const config = getConfig();
  const missing: string[] = [];
  if (!config.blikkAppId) missing.push("BLIKK_APP_ID");
  if (!config.blikkAppSecret) missing.push("BLIKK_APP_SECRET");
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  return config as Required<AppConfig>;
}
