import { createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

type SheetProperties = {
  sheetId: number;
  title: string;
  gridProperties?: {
    rowCount?: number;
    columnCount?: number;
  };
};

type SpreadsheetMetadata = {
  properties?: {
    title?: string;
  };
  sheets?: Array<{
    properties?: SheetProperties;
  }>;
};

type SheetValues = {
  values?: unknown[][];
};

let cachedToken: CachedToken | null = null;

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createServiceAccountJwt(
  serviceAccountEmail: string,
  privateKey: string
): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const header = base64Url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    })
  );

  const claims = base64Url(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );

  const unsignedJwt = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");

  signer.update(unsignedJwt);
  signer.end();

  const signature = signer
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedJwt}.${signature}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      error_description?: string;
    };

    if (typeof body.error === "object" && body.error?.message) {
      return body.error.message;
    }

    if (typeof body.error === "string") {
      return body.error_description
        ? `${body.error}: ${body.error_description}`
        : body.error;
    }
  } catch {
    // Returnera endast HTTP-status så känsliga svar inte exponeras.
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function getAccessToken(): Promise<string> {
  if (
    cachedToken &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.accessToken;
  }

  const serviceAccountEmail = requiredEnvironmentVariable(
    "GOOGLE_SERVICE_ACCOUNT_EMAIL"
  );

  const privateKey = requiredEnvironmentVariable(
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  ).replace(/\\n/g, "\n");

  const assertion = createServiceAccountJwt(
    serviceAccountEmail,
    privateKey
  );

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type:
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Google authentication failed: ${await readError(response)}`
    );
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!body.access_token) {
    throw new Error(
      "Google authentication returned no access token."
    );
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt:
      Date.now() + (body.expires_in ?? 3600) * 1000,
  };

  return cachedToken.accessToken;
}

async function googleSheetsGet<T>(url: string): Promise<T> {
  const accessToken = await getAccessToken();

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheets API error: ${await readError(response)}`
    );
  }

  return (await response.json()) as T;
}

function quotedSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function populatedColumnCount(rows: unknown[][]): number {
  return rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0
  );
}

export async function testGoogleSheetConnection() {
  const spreadsheetId =
    requiredEnvironmentVariable("GOOGLE_SHEET_ID");

  const configuredGid = Number(
    requiredEnvironmentVariable("GOOGLE_SHEET_GID")
  );

  if (
    !Number.isInteger(configuredGid) ||
    configuredGid < 0
  ) {
    throw new Error(
      "GOOGLE_SHEET_GID must be a non-negative integer."
    );
  }

  const metadataUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}`
  );

  metadataUrl.searchParams.set(
    "fields",
    "properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"
  );

  const metadata =
    await googleSheetsGet<SpreadsheetMetadata>(
      metadataUrl.toString()
    );

  const sheet = metadata.sheets
    ?.map((item) => item.properties)
    .find(
      (
        properties
      ): properties is SheetProperties =>
        properties?.sheetId === configuredGid
    );

  if (!sheet) {
    throw new Error(
      `No sheet tab with gid ${configuredGid} was found in the spreadsheet.`
    );
  }

  const range =
    `${quotedSheetTitle(sheet.title)}!A:ZZ`;

  const valuesUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}`;

  const valuesResponse =
    await googleSheetsGet<SheetValues>(valuesUrl);

  const rows = valuesResponse.values ?? [];

  const firstNonEmptyRow = rows.find((row) =>
    row.some(
      (cell) => String(cell ?? "").trim() !== ""
    )
  );

  return {
    connected: true,
    accessMode: "read-only",
    spreadsheetId,
    spreadsheetTitle:
      metadata.properties?.title ?? null,
    sheetGid: sheet.sheetId,
    sheetTitle: sheet.title,
    configuredRows:
      sheet.gridProperties?.rowCount ?? null,
    configuredColumns:
      sheet.gridProperties?.columnCount ?? null,
    populatedRows: rows.length,
    populatedColumns:
      populatedColumnCount(rows),
    headers: (firstNonEmptyRow ?? []).map(
      (cell) => String(cell ?? "").trim()
    ),
    checkedAt: new Date().toISOString(),
  };
}
