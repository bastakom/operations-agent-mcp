export type BlikkConfig = {
  baseUrl: string;
  appId: string;
  appSecret: string;
};

export function getBlikkConfig(): BlikkConfig {
  const baseUrl = process.env.BLIKK_BASE_URL;
  const appId = process.env.BLIKK_APP_ID;
  const appSecret = process.env.BLIKK_APP_SECRET;

  if (!baseUrl) {
    throw new Error("Missing environment variable: BLIKK_BASE_URL");
  }

  if (!appId) {
    throw new Error("Missing environment variable: BLIKK_APP_ID");
  }

  if (!appSecret) {
    throw new Error("Missing environment variable: BLIKK_APP_SECRET");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    appId,
    appSecret,
  };
}
