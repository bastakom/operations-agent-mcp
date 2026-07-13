import { blikkGet } from "./client";

export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
}) {
  return blikkGet<unknown>("/v1/Admin/Users", {
    page: params?.page ?? 1,
    pageSize: params?.pageSize ?? 100,
  });
}

export async function getProjects() {
  return blikkGet<unknown>("/v1/Core/Projects");
}

export async function getTimeReports(params: {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  projectId?: string;
}) {
  return blikkGet<unknown>("/v1/Core/TimeReports", params);
}

export async function getUserDayStatistics(params: {
  fromDate: string;
  toDate: string;
  userId?: string;
}) {
  return blikkGet<unknown>("/v1/Core/TimeReports/UserDayStatistics", params);
}

export async function getProjectTimeCalculation(projectId: string) {
  return blikkGet<unknown>(`/v1/Core/Projects/${projectId}/TimeCalculation`);
}
