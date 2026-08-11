import type {
  CompletePagedResponse,
} from "./endpoints";
import {
  getProjectCatalog,
  type ProjectCatalogItem,
} from "./resolvers";

export const NOINDEX_PROJECT_TAG = "NOINDEX";

type PlanningSummaryItem = Record<string, unknown>;

export type ClassifiedPlanningSummaries = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  pagesFetched: number;
  isComplete: true;
  counts: {
    regularProjects: number;
    noindexProjects: number;
    totalProjects: number;
    unclassifiedProjects: number;
  };
  regularProjects: PlanningSummaryItem[];
  noindexProjects: PlanningSummaryItem[];
  unclassifiedProjects: PlanningSummaryItem[];
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("sv");
}

export function isNoindexProject(
  project: ProjectCatalogItem
): boolean {
  return project.tags.some(
    (tag) =>
      tag.name.trim() === NOINDEX_PROJECT_TAG
  );
}

function stringValue(
  value: unknown
): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const result = String(value).trim();
    return result || null;
  }

  return null;
}

function recordValue(
  value: unknown
): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findProject(
  item: PlanningSummaryItem,
  projectsById: Map<
    string,
    ProjectCatalogItem
  >,
  projectsByTitle: Map<
    string,
    ProjectCatalogItem
  >
): ProjectCatalogItem | null {
  const nestedProject = recordValue(
    item.project
  );

  const idCandidates = [
    item.projectId,
    item.projectID,
    nestedProject?.id,
    nestedProject?.projectId,
  ];

  for (const candidate of idCandidates) {
    const id = stringValue(candidate);

    if (id && projectsById.has(id)) {
      return projectsById.get(id) ?? null;
    }
  }

  const titleCandidates = [
    item.projectName,
    item.projectTitle,
    nestedProject?.name,
    nestedProject?.title,
  ];

  for (const candidate of titleCandidates) {
    const title = stringValue(candidate);

    if (title) {
      const project = projectsByTitle.get(
        normalize(title)
      );

      if (project) {
        return project;
      }
    }
  }

  return null;
}

export function classifyPlanningSummaries(
  summaries: CompletePagedResponse<PlanningSummaryItem>,
  projectCatalog: ProjectCatalogItem[]
): ClassifiedPlanningSummaries {
  const projectsById = new Map(
    projectCatalog.map((project) => [
      project.id,
      project,
    ])
  );

  const projectsByTitle = new Map(
    projectCatalog.map((project) => [
      normalize(project.title),
      project,
    ])
  );

  const regularProjects: PlanningSummaryItem[] =
    [];

  const noindexProjects: PlanningSummaryItem[] =
    [];

  const unclassifiedProjects: PlanningSummaryItem[] =
    [];

  for (const item of summaries.items) {
    const project = findProject(
      item,
      projectsById,
      projectsByTitle
    );

    if (!project) {
      // Preserve unmatched Blikk data in the
      // ordinary result while making the
      // missing classification visible.
      regularProjects.push(item);
      unclassifiedProjects.push(item);
    } else if (isNoindexProject(project)) {
      noindexProjects.push(item);
    } else {
      regularProjects.push(item);
    }
  }

  return {
    page: summaries.page,
    pageSize: summaries.pageSize,
    itemCount: summaries.itemCount,
    totalItemCount:
      summaries.totalItemCount,
    totalPages: summaries.totalPages,
    pagesFetched: summaries.pagesFetched,
    isComplete: summaries.isComplete,
    counts: {
      regularProjects:
        regularProjects.length,
      noindexProjects:
        noindexProjects.length,
      totalProjects: summaries.items.length,
      unclassifiedProjects:
        unclassifiedProjects.length,
    },
    regularProjects,
    noindexProjects,
    unclassifiedProjects,
  };
}

export async function getClassifiedPlanningSummariesForUser(
  summaries: CompletePagedResponse<PlanningSummaryItem>
): Promise<ClassifiedPlanningSummaries> {
  const projectCatalog =
    await getProjectCatalog();

  return classifyPlanningSummaries(
    summaries,
    projectCatalog
  );
}
