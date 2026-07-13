import { blikkGet, QueryParams } from "./client";

function paged(query: QueryParams = {}): QueryParams {
  return {
    page: 1,
    pageSize: 100,
    ...query,
  };
}

export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
}) {
  return blikkGet<unknown>(
    "/v1/Admin/Users",
    paged({
      page: params?.page,
      pageSize: params?.pageSize,
    })
  );
}

export async function getProjects(params?: {
  page?: number;
  pageSize?: number;
}) {
  return blikkGet<unknown>(
    "/v1/Core/Projects",
    paged({
      page: params?.page,
      pageSize: params?.pageSize,
    })
  );
}

export async function getTimeReports(params: {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
}) {
  return blikkGet<unknown>(
    "/v1/Core/TimeReports",
    paged(params)
  );
}

export async function getUserDayStatistics(params: {
  fromDate: string;
  toDate: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}) {
  return blikkGet<unknown>(
    "/v1/Core/TimeReports/UserDayStatistics",
    paged(params)
  );
}

export async function getProjectTimeCalculation(projectId: string) {
  return blikkGet<unknown>(
    `/v1/Core/Projects/${projectId}/TimeCalculation`
  );
}
