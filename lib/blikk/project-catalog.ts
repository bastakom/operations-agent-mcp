import {
  getProjectCatalog,
  ProjectCatalogItem,
} from "./resolvers";

export type ProjectCatalogQuery = {
  query?: string;
  status?: string;
  customer?: string;
  isCompleted?: boolean;
  page?: number;
  pageSize?: number;
};

type StatusSummary = {
  status: string;
  count: number;
};

export type ProjectCatalogResult = {
  totalProjects: number;
  totalMatches: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    query: string | null;
    status: string | null;
    customer: string | null;
    isCompleted: boolean | null;
  };
  statusSummary: StatusSummary[];
  projects: ProjectCatalogItem[];
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function createStatusSummary(
  projects: ProjectCatalogItem[]
): StatusSummary[] {
  const counts = new Map<string, number>();

  for (const project of projects) {
    const status = project.status ?? "Okänd status";

    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([status, count]) => ({
      status,
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.status.localeCompare(b.status, "sv");
    });
}

export async function getProjectCatalogView(
  params: ProjectCatalogQuery = {}
): Promise<ProjectCatalogResult> {
  const allProjects = await getProjectCatalog();

  const normalizedQuery = params.query
    ? normalize(params.query)
    : null;

  const normalizedStatus = params.status
    ? normalize(params.status)
    : null;

  const normalizedCustomer = params.customer
    ? normalize(params.customer)
    : null;

  const requestedPage = Math.max(
    Math.floor(params.page ?? 1),
    1
  );

  const requestedPageSize = Math.min(
    Math.max(Math.floor(params.pageSize ?? 50), 1),
    100
  );

  const filteredProjects = allProjects.filter((project) => {
    if (
      typeof params.isCompleted === "boolean" &&
      project.isCompleted !== params.isCompleted
    ) {
      return false;
    }

    if (
      normalizedStatus &&
      normalize(project.status ?? "") !== normalizedStatus
    ) {
      return false;
    }

    if (
      normalizedCustomer &&
      !normalize(project.customerName ?? "").includes(
        normalizedCustomer
      )
    ) {
      return false;
    }

    if (normalizedQuery) {
      const searchableValues = [
        project.title,
        project.orderNumber ?? "",
        project.customerName ?? "",
        project.status ?? "",
      ];

      const matchesQuery = searchableValues.some((value) =>
        normalize(value).includes(normalizedQuery)
      );

      if (!matchesQuery) {
        return false;
      }
    }

    return true;
  });

  const sortedProjects = [...filteredProjects].sort((a, b) =>
    a.title.localeCompare(b.title, "sv")
  );

  const totalMatches = sortedProjects.length;
  const totalPages =
    totalMatches === 0
      ? 0
      : Math.ceil(totalMatches / requestedPageSize);

  const startIndex =
    (requestedPage - 1) * requestedPageSize;

  const projects = sortedProjects.slice(
    startIndex,
    startIndex + requestedPageSize
  );

  return {
    totalProjects: allProjects.length,
    totalMatches,
    page: requestedPage,
    pageSize: requestedPageSize,
    totalPages,
    filters: {
      query: params.query?.trim() || null,
      status: params.status?.trim() || null,
      customer: params.customer?.trim() || null,
      isCompleted:
        typeof params.isCompleted === "boolean"
          ? params.isCompleted
          : null,
    },
    statusSummary: createStatusSummary(filteredProjects),
    projects,
  };
}
