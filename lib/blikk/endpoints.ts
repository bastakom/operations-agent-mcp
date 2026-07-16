import { blikkGet, QueryParams } from "./client";

function paged(query: QueryParams = {}): QueryParams {
  const result: QueryParams = {
    ...query,
  };

  if (result.page == null) {
    result.page = 1;
  }

  if (result.pageSize == null) {
    result.pageSize = 100;
  }

  return result;
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
    paged({
      page: params.page,
      pageSize: params.pageSize,

      "filter.from": params.fromDate,
      "filter.to": params.toDate,

      "filter.userIds": params.userId,

      "filter.projectId": params.projectId,
    })
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
    paged({
      page: params.page,
      pageSize: params.pageSize,

      "filter.from": params.fromDate,
      "filter.to": params.toDate,

      "filter.userIds": params.userId,
    })
  );
}

export async function getProjectTimeCalculation(projectId: string) {
  return blikkGet<unknown>(
    `/v1/Core/Projects/${projectId}/TimeCalculation`
  );
}

export async function getUsersWithResourcePlanning(params: {
  fromDate: string;
  toDate: string;
  page?: number;
  pageSize?: number;
  excludeDeleted?: boolean;
  excludeRestricted?: boolean;
}) {
  return blikkGet<unknown>(
    "/v1/Core/Planning/HasResourcePlanning/Users",
    paged({
      fromDate: params.fromDate,
      toDate: params.toDate,
      page: params.page,
      pageSize: params.pageSize,
      excludeDeleted: params.excludeDeleted ?? true,
      excludeRestricted: params.excludeRestricted ?? true,
    })
  );
}
