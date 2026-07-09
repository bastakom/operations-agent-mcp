import { getConfig } from "../config";
import { getBlikkAccessToken } from "./auth";
import type { BlikkPagedList, BlikkProject, BlikkTimeReport, BlikkUser } from "./types";

export type QueryValue = string | number | boolean | undefined | null;

function toQueryString(params: Record<string, QueryValue>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const output = query.toString();
  return output ? `?${output}` : "";
}

export async function blikkRequest<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const token = await getBlikkAccessToken();
  const { blikkBaseUrl } = getConfig();
  const url = `${blikkBaseUrl}${path}${toQueryString(params)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Blikk API-fel ${response.status} för ${path}. Svar: ${bodyText || "tomt svar"}`
    );
  }

  if (!bodyText) {
    return null as T;
  }

  return JSON.parse(bodyText) as T;
}

export async function getBlikkUsers(page = 1, pageSize = 100) {
  return blikkRequest<BlikkPagedList<BlikkUser>>("/v1/Admin/Users", { page, pageSize });
}

export async function getBlikkProjects(page = 1, pageSize = 100) {
  return blikkRequest<BlikkPagedList<BlikkProject>>("/v1/Core/Projects", { page, pageSize });
}

export async function getBlikkTimeReports(input: {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  userId?: number;
  projectId?: number;
}) {
  return blikkRequest<BlikkPagedList<BlikkTimeReport>>("/v1/Core/TimeReports", {
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 100,
    "filter.dateFrom": input.dateFrom,
    "filter.dateTo": input.dateTo,
    "filter.userId": input.userId,
    "filter.projectId": input.projectId,
  });
}
