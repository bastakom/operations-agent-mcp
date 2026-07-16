import {
  getProjectTimeCalculation,
  getTimeReports,
} from "./endpoints";
import {
  getProjectCatalog,
  ProjectCatalogItem,
  resolveProjectId,
} from "./resolvers";

type ProjectTimeCalculation = {
  objectName?: string;
  total: number;
  isTotal?: boolean;
  isByActivity?: boolean;
  isByActivityAndUser?: boolean;
};

type TimeReport = {
  id: number;
  hours: number;
};

type TimeReportResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: TimeReport[];
};

export type ProjectBudgetStatus = {
  requestedProject: string;
  projectId: string;
  budgetHours: number;
  reportedHours: number;
  remainingHours: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean;
  overBudgetHours: number;
};

export type ActiveProjectBudgetItem = {
  projectId: string;
  orderNumber: string | null;
  project: string;
  customerName: string | null;
  status: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  budgetHours: number | null;
  reportedHours: number | null;
  remainingHours: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean | null;
  overBudgetHours: number | null;
  error: string | null;
};

export type ActiveProjectBudgetReport = {
  generatedAt: string;
  cacheExpiresAt: string;
  totalProjects: number;
  activeProjects: number;
  successfulProjects: number;
  failedProjects: number;
  overBudgetProjects: number;
  totalBudgetHours: number;
  totalReportedHours: number;
  totalRemainingHours: number;
  projects: ActiveProjectBudgetItem[];
};

type ActiveBudgetCache = {
  report: ActiveProjectBudgetReport;
  expiresAt: number;
};

const REQUEST_DELAY_MS = 300;
const RATE_LIMIT_RETRY_MS = 1200;
const MAX_RATE_LIMIT_RETRIES = 3;
const ACTIVE_BUDGET_CACHE_TTL_MS = 30 * 60 * 1000;

let activeBudgetCache: ActiveBudgetCache | null = null;
let activeBudgetLoadPromise:
  | Promise<ActiveProjectBudgetReport>
  | null = null;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("(429)") ||
      error.message.includes(" 429") ||
      error.message.toLowerCase().includes("too many requests"))
  );
}

async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= MAX_RATE_LIMIT_RETRIES + 1;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (
        !isRateLimitError(error) ||
        attempt > MAX_RATE_LIMIT_RETRIES
      ) {
        throw error;
      }

      const retryDelay = RATE_LIMIT_RETRY_MS * attempt;

      console.warn(
        `${operationName} was rate limited. Retrying in ${retryDelay} ms.`
      );

      await wait(retryDelay);
    }
  }

  throw lastError;
}

async function getAllProjectTimeReports(
  projectId: string
): Promise<TimeReport[]> {
  const firstPage = await withRateLimitRetry(
    async () =>
      (await getTimeReports({
        projectId,
        page: 1,
        pageSize: 100,
      })) as TimeReportResponse,
    `Time reports for project ${projectId}, page 1`
  );

  const reports: TimeReport[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(REQUEST_DELAY_MS);

    const response = await withRateLimitRetry(
      async () =>
        (await getTimeReports({
          projectId,
          page,
          pageSize: 100,
        })) as TimeReportResponse,
      `Time reports for project ${projectId}, page ${page}`
    );

    reports.push(...response.items);
  }

  return reports;
}

async function getProjectBudgetStatusById(
  projectId: string,
  projectName: string
): Promise<ProjectBudgetStatus> {
  const calculation = await withRateLimitRetry(
    async () =>
      (await getProjectTimeCalculation(
        projectId
      )) as ProjectTimeCalculation,
    `Time calculation for project ${projectId}`
  );

  if (
    !calculation ||
    typeof calculation.total !== "number"
  ) {
    throw new Error(
      `No valid time calculation was found for project '${projectName}'.`
    );
  }

  await wait(REQUEST_DELAY_MS);

  const reports = await getAllProjectTimeReports(projectId);

  const budgetHours = calculation.total;

  const reportedHours = reports.reduce(
    (sum, report) => sum + Number(report.hours || 0),
    0
  );

  const remainingHours = budgetHours - reportedHours;
  const isOverBudget = remainingHours < 0;

  const usedPercent =
    budgetHours > 0
      ? (reportedHours / budgetHours) * 100
      : null;

  const remainingPercent =
    budgetHours > 0
      ? (remainingHours / budgetHours) * 100
      : null;

  return {
    requestedProject: projectName,
    projectId,
    budgetHours: round(budgetHours),
    reportedHours: round(reportedHours),
    remainingHours: round(remainingHours),
    usedPercent:
      usedPercent === null ? null : round(usedPercent),
    remainingPercent:
      remainingPercent === null
        ? null
        : round(remainingPercent),
    isOverBudget,
    overBudgetHours: isOverBudget
      ? round(Math.abs(remainingHours))
      : 0,
  };
}

export async function getProjectBudgetStatus(
  projectName: string
): Promise<ProjectBudgetStatus> {
  const projectId = await resolveProjectId(projectName);

  return getProjectBudgetStatusById(projectId, projectName);
}

function createSuccessfulItem(
  project: ProjectCatalogItem,
  budgetStatus: ProjectBudgetStatus
): ActiveProjectBudgetItem {
  return {
    projectId: project.id,
    orderNumber: project.orderNumber,
    project: project.title,
    customerName: project.customerName,
    status: project.status,
    projectManagerId: project.projectManagerId,
    projectManagerName: project.projectManagerName,
    budgetHours: budgetStatus.budgetHours,
    reportedHours: budgetStatus.reportedHours,
    remainingHours: budgetStatus.remainingHours,
    usedPercent: budgetStatus.usedPercent,
    remainingPercent: budgetStatus.remainingPercent,
    isOverBudget: budgetStatus.isOverBudget,
    overBudgetHours: budgetStatus.overBudgetHours,
    error: null,
  };
}

function createFailedItem(
  project: ProjectCatalogItem,
  error: unknown
): ActiveProjectBudgetItem {
  return {
    projectId: project.id,
    orderNumber: project.orderNumber,
    project: project.title,
    customerName: project.customerName,
    status: project.status,
    projectManagerId: project.projectManagerId,
    projectManagerName: project.projectManagerName,
    budgetHours: null,
    reportedHours: null,
    remainingHours: null,
    usedPercent: null,
    remainingPercent: null,
    isOverBudget: null,
    overBudgetHours: null,
    error:
      error instanceof Error
        ? error.message
        : "Unknown Blikk error",
  };
}

async function buildActiveProjectBudgetReport(): Promise<
  ActiveProjectBudgetReport
> {
  console.log("Building budget report for all active projects");

  const allProjects = await getProjectCatalog();

  const activeProjects = allProjects
    .filter((project) => project.isCompleted === false)
    .sort((a, b) => a.title.localeCompare(b.title, "sv"));

  const projects: ActiveProjectBudgetItem[] = [];

  for (let index = 0; index < activeProjects.length; index += 1) {
    const project = activeProjects[index];

    if (index > 0) {
      await wait(REQUEST_DELAY_MS);
    }

    console.log(
      `Calculating active project budget ${index + 1}/${activeProjects.length}: ${project.title}`
    );

    try {
      const budgetStatus = await getProjectBudgetStatusById(
        project.id,
        project.title
      );

      projects.push(createSuccessfulItem(project, budgetStatus));
    } catch (error) {
      console.error(
        `Failed to calculate budget status for project '${project.title}':`,
        error
      );

      projects.push(createFailedItem(project, error));
    }
  }

  const successfulProjects = projects.filter(
    (project) => project.error === null
  );

  const generatedAt = Date.now();
  const cacheExpiresAt =
    generatedAt + ACTIVE_BUDGET_CACHE_TTL_MS;

  const report: ActiveProjectBudgetReport = {
    generatedAt: new Date(generatedAt).toISOString(),
    cacheExpiresAt: new Date(cacheExpiresAt).toISOString(),
    totalProjects: allProjects.length,
    activeProjects: activeProjects.length,
    successfulProjects: successfulProjects.length,
    failedProjects:
      projects.length - successfulProjects.length,
    overBudgetProjects: successfulProjects.filter(
      (project) => project.isOverBudget === true
    ).length,
    totalBudgetHours: round(
      successfulProjects.reduce(
        (sum, project) => sum + (project.budgetHours ?? 0),
        0
      )
    ),
    totalReportedHours: round(
      successfulProjects.reduce(
        (sum, project) => sum + (project.reportedHours ?? 0),
        0
      )
    ),
    totalRemainingHours: round(
      successfulProjects.reduce(
        (sum, project) => sum + (project.remainingHours ?? 0),
        0
      )
    ),
    projects,
  };

  console.log(
    `Completed active project budget report: ${report.successfulProjects} succeeded, ${report.failedProjects} failed`
  );

  return report;
}

export async function getAllActiveProjectBudgetStatuses(): Promise<
  ActiveProjectBudgetReport
> {
  const now = Date.now();

  if (activeBudgetCache && activeBudgetCache.expiresAt > now) {
    console.log("Using cached active project budget report");
    return activeBudgetCache.report;
  }

  if (activeBudgetLoadPromise) {
    console.log("Waiting for ongoing active project budget report");
    return activeBudgetLoadPromise;
  }

  const loadPromise = buildActiveProjectBudgetReport();
  activeBudgetLoadPromise = loadPromise;

  try {
    const report = await loadPromise;

    activeBudgetCache = {
      report,
      expiresAt: Date.now() + ACTIVE_BUDGET_CACHE_TTL_MS,
    };

    return report;
  } finally {
    if (activeBudgetLoadPromise === loadPromise) {
      activeBudgetLoadPromise = null;
    }
  }
}
