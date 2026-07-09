import { blikkGet } from "./client";

export async function getUsers() {
  return blikkGet<unknown>("/v1/Admin/Users");
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
