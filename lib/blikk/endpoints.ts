import { blikkGet, QueryParams } from "./client";

export type PagedResponse<T = unknown> = {
  objectName?: string;
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: T[];
};

export type CompletePagedResponse<T = unknown> = PagedResponse<T> & {
  pagesFetched: number;
  isComplete: true;
};

export type BlikkRawItem = Record<string, unknown>;

const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 1100;
const MAX_RATE_LIMIT_RETRIES = 3;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function paged(query: QueryParams = {}): QueryParams {
  const result: QueryParams = { ...query };

  if (result.page == null) {
    result.page = 1;
  }

  if (result.pageSize == null) {
    result.pageSize = PAGE_SIZE;
  }

  return result;
}

function validatePagedResponse<T>(
  response: unknown,
  resourceName: string,
  page: number
): PagedResponse<T> {
  const candidate = response as Partial<PagedResponse<T>> | null;

  if (
    !candidate ||
    !Array.isArray(candidate.items) ||
    typeof candidate.totalPages !== "number"
  ) {
    throw new Error(
      `Blikk returned an unexpected paginated response for ${resourceName} on page ${page}.`
    );
  }

  return candidate as PagedResponse<T>;
}

async function fetchPageWithRetry<T>(
  fetchPage: (page: number, pageSize: number) => Promise<unknown>,
  resourceName: string,
  page: number
): Promise<PagedResponse<T>> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await fetchPage(page, PAGE_SIZE);
      return validatePagedResponse<T>(response, resourceName, page);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const isRateLimited = message.includes("429");

      if (
        !isRateLimited ||
        attempt === MAX_RATE_LIMIT_RETRIES
      ) {
        throw error;
      }

      await wait(PAGE_DELAY_MS * (attempt + 1));
    }
  }

  throw new Error(
    `Could not fetch ${resourceName} page ${page}.`
  );
}

export async function fetchAllPages<T = unknown>(
  fetchPage: (
    page: number,
    pageSize: number
  ) => Promise<unknown>,
  resourceName: string
): Promise<CompletePagedResponse<T>> {
  const firstPage = await fetchPageWithRetry<T>(
    fetchPage,
    resourceName,
    1
  );
  const sourceTotalPages = Math.max(
    firstPage.totalPages,
    1
  );
  const sourceTotalItemCount = firstPage.totalItemCount;
  const items = [...firstPage.items];

  for (
    let page = 2;
    page <= sourceTotalPages;
    page += 1
  ) {
    await wait(PAGE_DELAY_MS);

    const response = await fetchPageWithRetry<T>(
      fetchPage,
      resourceName,
      page
    );

    items.push(...response.items);
  }

  if (items.length !== sourceTotalItemCount) {
    console.warn(
      `Blikk reported ${sourceTotalItemCount} ${resourceName}, but ${items.length} items were fetched.`
    );
  }

  return {
    ...firstPage,
    page: 1,
    pageSize: PAGE_SIZE,
    itemCount: items.length,
    totalItemCount: items.length,
    totalPages: sourceTotalPages,
    pagesFetched: sourceTotalPages,
    isComplete: true,
    items,
  };
}

export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
}) {
  return blikkGet(
    "/v1/Admin/Users",
    paged({
      page: params?.page,
      pageSize: params?.pageSize,
    })
  );
}

export async function getAllUsers() {
  return fetchAllPages(
    (page, pageSize) =>
      getUsers({ page, pageSize }),
    "users"
  );
}

export async function getUser(
  userId: number | string
) {
  return blikkGet(`/v1/Admin/Users/${userId}`);
}

export async function getProjects(params?: {
  page?: number;
  pageSize?: number;
}) {
  return blikkGet(
    "/v1/Core/Projects",
    paged({
      page: params?.page,
      pageSize: params?.pageSize,
    })
  );
}

export async function getAllProjects() {
  return fetchAllPages(
    (page, pageSize) =>
      getProjects({ page, pageSize }),
    "projects"
  );
}

export type TimeReportParams = {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
};

export async function getTimeReports(
  params: TimeReportParams
) {
  return blikkGet(
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

export async function getAllTimeReports(
  params: Omit<
    TimeReportParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages(
    (page, pageSize) =>
      getTimeReports({
        ...params,
        page,
        pageSize,
      }),
    "time reports"
  );
}

export type UserDayStatisticsParams = {
  fromDate: string;
  toDate: string;
  userId?: string;
  page?: number;
  pageSize?: number;
};

export async function getUserDayStatistics(
  params: UserDayStatisticsParams
) {
  return blikkGet(
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

export async function getAllUserDayStatistics(
  params: Omit<
    UserDayStatisticsParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages(
    (page, pageSize) =>
      getUserDayStatistics({
        ...params,
        page,
        pageSize,
      }),
    "user day statistics"
  );
}

export async function getProjectTimeCalculation(
  projectId: string
) {
  return blikkGet(
    `/v1/Core/Projects/${projectId}/TimeCalculation`
  );
}

export type ResourcePlanningUsersParams = {
  fromDate: string;
  toDate: string;
  page?: number;
  pageSize?: number;
  excludeDeleted?: boolean;
  excludeRestricted?: boolean;
};

export async function getUsersWithResourcePlanning(
  params: ResourcePlanningUsersParams
) {
  return blikkGet(
    "/v1/Core/Planning/HasResourcePlanning/Users",
    paged({
      fromDate: params.fromDate,
      toDate: params.toDate,
      page: params.page,
      pageSize: params.pageSize,
      excludeDeleted:
        params.excludeDeleted ?? true,
      excludeRestricted:
        params.excludeRestricted ?? true,
    })
  );
}

export async function getAllUsersWithResourcePlanning(
  params: Omit<
    ResourcePlanningUsersParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages(
    (page, pageSize) =>
      getUsersWithResourcePlanning({
        ...params,
        page,
        pageSize,
      }),
    "users with resource planning"
  );
}

export type PlanningSummariesParams = {
  userId: string;
  fromDate: string;
  toDate: string;
  page?: number;
  pageSize?: number;
  excludeProjects?: boolean;
  excludeAbsence?: boolean;
  excludeInternal?: boolean;
};

export async function getPlanningSummariesForUser(
  params: PlanningSummariesParams
) {
  return blikkGet<PagedResponse<BlikkRawItem>>(
    "/v1/Core/Planning/GetPlanningSummaries/Projects",
    paged({
      userId: params.userId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      page: params.page,
      pageSize: params.pageSize,
      excludeProjects:
        params.excludeProjects ?? false,
      excludeAbsence:
        params.excludeAbsence ?? false,
      excludeInternal:
        params.excludeInternal ?? false,
    })
  );
}

export async function getAllPlanningSummariesForUser(
  params: Omit<
    PlanningSummariesParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages<BlikkRawItem>(
    (page, pageSize) =>
      getPlanningSummariesForUser({
        ...params,
        page,
        pageSize,
      }),
    "planning summaries"
  );
}

export type SupplierInvoiceParams = {
  projectId: string;
  invoiceDateFrom?: string;
  invoiceDateTo?: string;
  page?: number;
  pageSize?: number;
};

export async function getSupplierInvoices(
  params: SupplierInvoiceParams
) {
  return blikkGet<PagedResponse<BlikkRawItem>>(
    "/v1/Core/SupplierInvoices",
    paged({
      page: params.page,
      pageSize: params.pageSize,
      "filter.projectId": params.projectId,
      "filter.invoiceDateFrom":
        params.invoiceDateFrom,
      "filter.invoiceDateTo":
        params.invoiceDateTo,
    })
  );
}

export async function getAllSupplierInvoices(
  params: Omit<
    SupplierInvoiceParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages<BlikkRawItem>(
    (page, pageSize) =>
      getSupplierInvoices({
        ...params,
        page,
        pageSize,
      }),
    "supplier invoices"
  );
}

export type PaymentPlanParams = {
  projectId: string;
  page?: number;
  pageSize?: number;
};

export async function getPaymentPlans(
  params: PaymentPlanParams
) {
  return blikkGet<PagedResponse<BlikkRawItem>>(
    "/v1/Core/Paymentplans",
    paged({
      page: params.page,
      pageSize: params.pageSize,
      "filter.projectId": params.projectId,
    })
  );
}

export async function getAllPaymentPlans(
  params: Omit<
    PaymentPlanParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages<BlikkRawItem>(
    (page, pageSize) =>
      getPaymentPlans({
        ...params,
        page,
        pageSize,
      }),
    "payment plans"
  );
}

export type MaterialReportParams = {
  projectId: string;
  page?: number;
  pageSize?: number;
};

export async function getMaterialReports(
  params: MaterialReportParams
) {
  return blikkGet<PagedResponse<BlikkRawItem>>(
    "/v1/Core/MaterialReports",
    paged({
      page: params.page,
      pageSize: params.pageSize,
      "filter.projectId": params.projectId,
    })
  );
}

export async function getAllMaterialReports(
  params: Omit<
    MaterialReportParams,
    "page" | "pageSize"
  >
) {
  return fetchAllPages<BlikkRawItem>(
    (page, pageSize) =>
      getMaterialReports({
        ...params,
        page,
        pageSize,
      }),
    "material reports"
  );
}
