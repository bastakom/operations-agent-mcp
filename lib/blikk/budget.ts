import {
  getUser,
  getProjectTimeCalculation,
  getTimeReports,
} from "./endpoints";
import {
  getProjectCatalog,
  ProjectCatalogItem,
  resolveProject,
  resolveUserId,
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
  user?: {
    id: number | string;
    name: string;
  } | null;
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
  budgetLogicVersion: "budget-types-v1";
  requestedProject: string;
  projectId: string;
  budgetType: BudgetType;
  budgetTag: string | null;
  budgetStatusReliable: boolean;
  isUnlimited: boolean;
  configuredBudgetHours: number;
  budgetHours: number | null;
  effectiveBudgetHours: number | null;
  period: BudgetPeriod;
  reportedHours: number;
  remainingHours: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean | null;
  overBudgetHours: number | null;
  warnings: string[];
};

export type BudgetType =
  | "timbank"
  | "project"
  | "retainer"
  | "ongoing"
  | "unknown";

export type BudgetPeriod = {
  fromDate: string | null;
  toDate: string | null;
  monthCount: number | null;
  source: "project_lifetime" | "requested" | "current_month";
};

export type ExcludedUserBudgetItem = {
  requestedName: string;
  userId: string;
  userName: string;
  reportedHours: number;
  resolvedFrom:
    | "time_reports"
    | "user_registry"
    | "historical_tag_registry";
  exclusionSources: ("user_name" | "user_tag")[];
  matchedTags: string[];
};

export type ProjectBudgetStatusExcludingUsers = {
  budgetLogicVersion: "budget-types-v1";
  requestedProject: string;
  projectId: string;
  budgetType: BudgetType;
  budgetTag: string | null;
  budgetStatusReliable: boolean;
  isUnlimited: boolean;
  configuredBudgetHours: number;
  budgetHours: number | null;
  effectiveBudgetHours: number | null;
  period: BudgetPeriod;
  totalReportedHours: number;
  excludedReportedHours: number;
  adjustedReportedHours: number;
  remainingHours: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean | null;
  overBudgetHours: number | null;
  excludedUserTags: string[];
  excludedUsers: ExcludedUserBudgetItem[];
  warnings: string[];
};

export type ActiveProjectBudgetItem = {
  budgetLogicVersion: "budget-types-v1" | null;
  projectId: string;
  orderNumber: string | null;
  project: string;
  customerName: string | null;
  status: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  budgetType: BudgetType | null;
  budgetTag: string | null;
  budgetStatusReliable: boolean | null;
  isUnlimited: boolean | null;
  configuredBudgetHours: number | null;
  budgetHours: number | null;
  effectiveBudgetHours: number | null;
  period: BudgetPeriod | null;
  reportedHours: number | null;
  remainingHours: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean | null;
  overBudgetHours: number | null;
  warnings: string[];
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
  unlimitedProjects: number;
  unclassifiedProjects: number;
  projectsWithWarnings: number;
  totalBudgetHours: number;
  totalReportedHours: number;
  totalRemainingHours: number;
  projects: ActiveProjectBudgetItem[];
};

export type BudgetTagAuditStatus =
  | "valid"
  | "missing"
  | "multiple";

export type BudgetTagAuditItem = {
  projectId: string;
  orderNumber: string | null;
  project: string;
  customerName: string | null;
  status: string | null;
  isCompleted: boolean | null;
  allTags: string[];
  matchedBudgetTags: string[];
  budgetTypes: BudgetType[];
  auditStatus: BudgetTagAuditStatus;
  warning: string | null;
};

export type BudgetTagAuditReport = {
  budgetLogicVersion: "budget-types-v1";
  generatedAt: string;
  scope: "active_projects" | "all_projects";
  validBudgetTags: string[];
  totalProjects: number;
  validProjects: number;
  missingBudgetTagProjects: number;
  multipleBudgetTagProjects: number;
  countsByBudgetType: {
    timbank: number;
    project: number;
    retainer: number;
    ongoing: number;
  };
  valid: BudgetTagAuditItem[];
  missing: BudgetTagAuditItem[];
  multiple: BudgetTagAuditItem[];
};

type ActiveBudgetCache = {
  report: ActiveProjectBudgetReport;
  expiresAt: number;
};

const REQUEST_DELAY_MS = 300;
const RATE_LIMIT_RETRY_MS = 1200;
const MAX_RATE_LIMIT_RETRIES = 3;
const ACTIVE_BUDGET_CACHE_TTL_MS = 30 * 60 * 1000;

const BUDGET_TAGS: Record<string, BudgetType> = {
  timbank: "timbank",
  projekt: "project",
  retainer: "retainer",
  "löpande": "ongoing",
};

// Historical user tags
//
// Add a person here BEFORE their Blikk account is deleted. Use the Blikk user
// ID from a time report, never just the person's name. This lets old reports
// keep their correct tag-based treatment after the account is gone.
//
// Example:
// "12345": { userName: "Anna Andersson", tags: ["Praktikant"] },
const HISTORICAL_USER_TAGS: Record<
  string,
  { userName: string; tags: string[] }
> = {
  // Add former employees here.
};

type BudgetContext = {
  budgetType: BudgetType;
  budgetTag: string | null;
  budgetStatusReliable: boolean;
  isUnlimited: boolean;
  configuredBudgetHours: number;
  effectiveBudgetHours: number | null;
  period: BudgetPeriod;
  warnings: string[];
};

type BudgetMetrics = {
  remainingHours: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean | null;
  overBudgetHours: number | null;
};

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

function normalizeTagName(value: string): string {
  return value.trim().toLocaleLowerCase("sv-SE");
}

function parseDate(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must use the YYYY-MM-DD format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }

  return date;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getCurrentMonthRange(): {
  fromDate: string;
  toDate: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(
    parts.find((part) => part.type === "year")?.value
  );
  const month = Number(
    parts.find((part) => part.type === "month")?.value
  );
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    fromDate: formatDate(year, month, 1),
    toDate: formatDate(year, month, lastDay),
  };
}

function resolveRetainerPeriod(
  fromDate?: string,
  toDate?: string
): BudgetPeriod {
  if ((fromDate && !toDate) || (!fromDate && toDate)) {
    throw new Error(
      "Both fromDate and toDate are required when specifying a retainer period."
    );
  }

  if (!fromDate && !toDate) {
    const currentMonth = getCurrentMonthRange();

    return {
      ...currentMonth,
      monthCount: 1,
      source: "current_month",
    };
  }

  const parsedFromDate = parseDate(fromDate!, "fromDate");
  const parsedToDate = parseDate(toDate!, "toDate");

  if (parsedFromDate.getTime() > parsedToDate.getTime()) {
    throw new Error("fromDate must be before or equal to toDate.");
  }

  const monthCount =
    (parsedToDate.getUTCFullYear() - parsedFromDate.getUTCFullYear()) * 12 +
    parsedToDate.getUTCMonth() -
    parsedFromDate.getUTCMonth() +
    1;

  return {
    fromDate: fromDate!,
    toDate: toDate!,
    monthCount,
    source: "requested",
  };
}

function classifyBudgetType(project: ProjectCatalogItem): {
  budgetType: BudgetType;
  budgetTag: string | null;
  warnings: string[];
} {
  const matches = project.tags
    .map((tag) => ({
      tag,
      budgetType: BUDGET_TAGS[normalizeTagName(tag.name)],
    }))
    .filter(
      (match): match is {
        tag: ProjectCatalogItem["tags"][number];
        budgetType: BudgetType;
      } => Boolean(match.budgetType)
    );

  if (matches.length > 1) {
    throw new Error(
      `Project '${project.title}' has multiple budget tags: ${matches
        .map((match) => match.tag.name)
        .join(", ")}. Keep exactly one of Timbank, Projekt, Retainer or Löpande.`
    );
  }

  if (matches.length === 0) {
    return {
      budgetType: "unknown",
      budgetTag: null,
      warnings: [
        "Projektet saknar budgetetikett. Lägg till Timbank, Projekt, Retainer eller Löpande.",
      ],
    };
  }

  return {
    budgetType: matches[0].budgetType,
    budgetTag: matches[0].tag.name,
    warnings: [],
  };
}

function createBudgetContext(
  project: ProjectCatalogItem,
  configuredBudgetHours: number,
  fromDate?: string,
  toDate?: string
): BudgetContext {
  const classification = classifyBudgetType(project);

  if (classification.budgetType === "retainer") {
    const period = resolveRetainerPeriod(fromDate, toDate);
    const effectiveBudgetHours =
      configuredBudgetHours * (period.monthCount ?? 1);

    return {
      ...classification,
      budgetStatusReliable: true,
      isUnlimited: false,
      configuredBudgetHours,
      effectiveBudgetHours,
      period,
    };
  }

  const period: BudgetPeriod = {
    fromDate: null,
    toDate: null,
    monthCount: null,
    source: "project_lifetime",
  };

  if (classification.budgetType === "ongoing") {
    return {
      ...classification,
      budgetStatusReliable: true,
      isUnlimited: true,
      configuredBudgetHours,
      effectiveBudgetHours: null,
      period,
    };
  }

  if (classification.budgetType === "unknown") {
    return {
      ...classification,
      budgetStatusReliable: false,
      isUnlimited: false,
      configuredBudgetHours,
      effectiveBudgetHours: null,
      period,
    };
  }

  return {
    ...classification,
    budgetStatusReliable: true,
    isUnlimited: false,
    configuredBudgetHours,
    effectiveBudgetHours: configuredBudgetHours,
    period,
  };
}

function calculateBudgetMetrics(
  context: BudgetContext,
  reportedHours: number
): BudgetMetrics {
  if (
    !context.budgetStatusReliable ||
    context.isUnlimited ||
    context.effectiveBudgetHours === null
  ) {
    return {
      remainingHours: null,
      usedPercent: null,
      remainingPercent: null,
      isOverBudget: null,
      overBudgetHours: null,
    };
  }

  const remainingHours = context.effectiveBudgetHours - reportedHours;
  const isOverBudget = remainingHours < 0;
  const usedPercent =
    context.effectiveBudgetHours > 0
      ? (reportedHours / context.effectiveBudgetHours) * 100
      : null;
  const remainingPercent =
    context.effectiveBudgetHours > 0
      ? (remainingHours / context.effectiveBudgetHours) * 100
      : null;

  return {
    remainingHours: round(remainingHours),
    usedPercent: usedPercent === null ? null : round(usedPercent),
    remainingPercent:
      remainingPercent === null ? null : round(remainingPercent),
    isOverBudget,
    overBudgetHours: isOverBudget
      ? round(Math.abs(remainingHours))
      : 0,
  };
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

function validateTimeReportResponse(
  response: TimeReportResponse,
  operationName: string
): void {
  if (!response || !Array.isArray(response.items)) {
    throw new Error(
      `Blikk returned an unexpected response for ${operationName}.`
    );
  }
}

function sumReportedHours(reports: TimeReport[]): number {
  return reports.reduce(
    (sum, report) => sum + Number(report.hours || 0),
    0
  );
}

type ReportedProjectUser = {
  userId: string;
  userName: string;
  reportedHours: number;
};

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("sv-SE");
}

function getUserTagNames(userDetail: unknown): string[] {
  if (!userDetail || typeof userDetail !== "object") {
    return [];
  }

  const tags = (userDetail as { tags?: unknown }).tags;

  if (!Array.isArray(tags)) {
    return [];
  }

  const uniqueNames = new Set<string>();

  for (const tag of tags) {
    if (!tag || typeof tag !== "object") {
      continue;
    }

    const candidate = tag as { name?: unknown; title?: unknown };
    const name =
      typeof candidate.name === "string"
        ? candidate.name
        : typeof candidate.title === "string"
          ? candidate.title
          : null;

    if (name && name.trim().length > 0) {
      uniqueNames.add(name.trim());
    }
  }

  return [...uniqueNames];
}

function getHistoricalUserTagNames(userId: string): string[] {
  const entry = HISTORICAL_USER_TAGS[userId];

  if (!entry) {
    return [];
  }

  return entry.tags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function getMatchingTagNames(
  availableTags: string[],
  requestedTags: string[]
): string[] {
  const requestedTagNames = new Set(
    requestedTags.map((tag) => normalizeName(tag))
  );

  return availableTags.filter((tag) =>
    requestedTagNames.has(normalizeName(tag))
  );
}

function getMatchingUserTags(
  userDetail: unknown,
  requestedTags: string[]
): string[] {
  return getMatchingTagNames(
    getUserTagNames(userDetail),
    requestedTags
  );
}

function getReportedProjectUsers(
  reports: TimeReport[]
): ReportedProjectUser[] {
  const usersById = new Map<string, ReportedProjectUser>();

  for (const report of reports) {
    if (
      !report.user ||
      report.user.id === null ||
      report.user.id === undefined ||
      typeof report.user.name !== "string" ||
      report.user.name.trim().length === 0
    ) {
      continue;
    }

    const userId = String(report.user.id);
    const userName = report.user.name.trim();
    const reportedHours = Number(report.hours || 0);
    const existingUser = usersById.get(userId);

    if (existingUser) {
      existingUser.reportedHours += reportedHours;
    } else {
      usersById.set(userId, {
        userId,
        userName,
        reportedHours,
      });
    }
  }

  return [...usersById.values()];
}

function resolveUserFromTimeReports(
  requestedName: string,
  reportedUsers: ReportedProjectUser[]
): ReportedProjectUser | null {
  const normalizedRequestedName = normalizeName(requestedName);

  const exactMatches = reportedUsers.filter(
    (user) => normalizeName(user.userName) === normalizedRequestedName
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    const matchingNames = exactMatches
      .map((user) => `${user.userName} (ID ${user.userId})`)
      .join(", ");

    throw new Error(
      `Multiple users in the project's time reports exactly match '${requestedName}': ${matchingNames}. Please use a more specific name.`
    );
  }

  const partialMatches = reportedUsers.filter((user) =>
    normalizeName(user.userName).includes(normalizedRequestedName)
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    const matchingNames = partialMatches
      .map((user) => `${user.userName} (ID ${user.userId})`)
      .join(", ");

    throw new Error(
      `Multiple users in the project's time reports match '${requestedName}': ${matchingNames}. Please use a more specific name.`
    );
  }

  return null;
}

async function getAllProjectTimeReports(
  projectId: string,
  userId?: string,
  fromDate?: string,
  toDate?: string
): Promise<TimeReport[]> {
  const operationDescription = [
    `project ${projectId}`,
    userId ? `user ${userId}` : null,
    fromDate && toDate ? `${fromDate} to ${toDate}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const firstPage = await withRateLimitRetry(
    async () =>
      (await getTimeReports({
        projectId,
        userId,
        fromDate,
        toDate,
        page: 1,
        pageSize: 100,
      })) as TimeReportResponse,
    `Time reports for ${operationDescription}, page 1`
  );

  validateTimeReportResponse(
    firstPage,
    `time reports for ${operationDescription}, page 1`
  );

  const reports: TimeReport[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(REQUEST_DELAY_MS);

    const response = await withRateLimitRetry(
      async () =>
        (await getTimeReports({
          projectId,
          userId,
          fromDate,
          toDate,
          page,
          pageSize: 100,
        })) as TimeReportResponse,
      `Time reports for ${operationDescription}, page ${page}`
    );

    validateTimeReportResponse(
      response,
      `time reports for ${operationDescription}, page ${page}`
    );

    reports.push(...response.items);
  }

  return reports;
}

async function getProjectTimeBudget(
  projectId: string,
  projectName: string
): Promise<number> {
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

  return calculation.total;
}

async function getProjectBudgetStatusForProject(
  project: ProjectCatalogItem,
  requestedProject: string,
  fromDate?: string,
  toDate?: string
): Promise<ProjectBudgetStatus> {
  const configuredBudgetHours = await getProjectTimeBudget(
    project.id,
    project.title
  );

  const context = createBudgetContext(
    project,
    configuredBudgetHours,
    fromDate,
    toDate
  );

  await wait(REQUEST_DELAY_MS);

  const reports = await getAllProjectTimeReports(
    project.id,
    undefined,
    context.period.fromDate ?? undefined,
    context.period.toDate ?? undefined
  );
  const reportedHours = sumReportedHours(reports);
  const metrics = calculateBudgetMetrics(context, reportedHours);

  return {
    budgetLogicVersion: "budget-types-v1",
    requestedProject,
    projectId: project.id,
    budgetType: context.budgetType,
    budgetTag: context.budgetTag,
    budgetStatusReliable: context.budgetStatusReliable,
    isUnlimited: context.isUnlimited,
    configuredBudgetHours: round(context.configuredBudgetHours),
    budgetHours:
      context.effectiveBudgetHours === null
        ? null
        : round(context.effectiveBudgetHours),
    effectiveBudgetHours:
      context.effectiveBudgetHours === null
        ? null
        : round(context.effectiveBudgetHours),
    period: context.period,
    reportedHours: round(reportedHours),
    ...metrics,
    warnings: context.warnings,
  };
}

export async function getProjectBudgetStatus(
  projectName: string,
  fromDate?: string,
  toDate?: string
): Promise<ProjectBudgetStatus> {
  const project = await resolveProject(projectName);

  return getProjectBudgetStatusForProject(
    project,
    projectName,
    fromDate,
    toDate
  );
}

export async function getProjectBudgetStatusExcludingUsers(
  projectName: string,
  excludedUserNames: string[] = [],
  fromDate?: string,
  toDate?: string,
  excludedUserTags: string[] = []
): Promise<ProjectBudgetStatusExcludingUsers> {
  const cleanedUserNames = excludedUserNames
    .map((userName) => userName.trim())
    .filter((userName) => userName.length > 0);
  const userTagsByNormalizedName = new Map<string, string>();

  for (const rawTag of excludedUserTags) {
    const tag = rawTag.trim();

    if (tag.length > 0) {
      userTagsByNormalizedName.set(normalizeName(tag), tag);
    }
  }

  const cleanedUserTags = [...userTagsByNormalizedName.values()];

  if (cleanedUserNames.length === 0 && cleanedUserTags.length === 0) {
    throw new Error(
      "At least one user name or user tag must be provided for exclusion."
    );
  }

  console.log(
    `Calculating budget for '${projectName}' excluding users: ${cleanedUserNames.join(
      ", "
    ) || "none"}; tags: ${cleanedUserTags.join(", ") || "none"}`
  );

  const project = await resolveProject(projectName);

  const configuredBudgetHours = await getProjectTimeBudget(
    project.id,
    project.title
  );

  const context = createBudgetContext(
    project,
    configuredBudgetHours,
    fromDate,
    toDate
  );

  await wait(REQUEST_DELAY_MS);

  const allReports = await getAllProjectTimeReports(
    project.id,
    undefined,
    context.period.fromDate ?? undefined,
    context.period.toDate ?? undefined
  );
  const totalReportedHours = sumReportedHours(allReports);
  const reportedUsers = getReportedProjectUsers(allReports);
  let allTimeReportedUsers: ReportedProjectUser[] | null = null;
  const warnings = [...context.warnings];
  const excludedUsersById = new Map<string, ExcludedUserBudgetItem>();

  function addExcludedUser(
    user: {
      requestedName: string;
      userId: string;
      userName: string;
      reportedHours: number;
      resolvedFrom: "time_reports" | "user_registry";
    },
    source: "user_name" | "user_tag",
    matchedTags: string[] = []
  ): void {
    const existing = excludedUsersById.get(user.userId);

    if (existing) {
      if (!existing.exclusionSources.includes(source)) {
        existing.exclusionSources.push(source);
      }

      for (const tag of matchedTags) {
        if (!existing.matchedTags.includes(tag)) {
          existing.matchedTags.push(tag);
        }
      }

      return;
    }

    excludedUsersById.set(user.userId, {
      ...user,
      reportedHours: round(user.reportedHours),
      exclusionSources: [source],
      matchedTags: [...matchedTags],
    });
  }

  for (const requestedName of cleanedUserNames) {
    let reportedUser = resolveUserFromTimeReports(
      requestedName,
      reportedUsers
    );

    if (!reportedUser && context.budgetType === "retainer") {
      if (!allTimeReportedUsers) {
        await wait(REQUEST_DELAY_MS);
        const allTimeReports = await getAllProjectTimeReports(project.id);
        allTimeReportedUsers = getReportedProjectUsers(allTimeReports);
      }

      const historicalUser = resolveUserFromTimeReports(
        requestedName,
        allTimeReportedUsers
      );

      if (historicalUser) {
        reportedUser = {
          ...historicalUser,
          reportedHours: 0,
        };
      }
    }

    let userId: string;
    let userName: string;
    let reportedHours: number;
    let resolvedFrom: "time_reports" | "user_registry";

    if (reportedUser) {
      userId = reportedUser.userId;
      userName = reportedUser.userName;
      reportedHours = reportedUser.reportedHours;
      resolvedFrom = "time_reports";
    } else {
      userId = await resolveUserId(requestedName);
      userName = requestedName;
      reportedHours = 0;
      resolvedFrom = "user_registry";
    }

    addExcludedUser({
      requestedName,
      userId,
      userName,
      reportedHours,
      resolvedFrom,
    }, "user_name");
  }

  if (cleanedUserTags.length > 0) {
    for (let index = 0; index < reportedUsers.length; index += 1) {
      const reportedUser = reportedUsers[index];

      if (index > 0) {
        await wait(REQUEST_DELAY_MS);
      }

      try {
        const userDetail = await withRateLimitRetry(
          () => getUser(reportedUser.userId),
          `User profile for ${reportedUser.userName} (ID ${reportedUser.userId})`
        );
        const matchedTags = getMatchingUserTags(
          userDetail,
          cleanedUserTags
        );

        if (matchedTags.length > 0) {
          addExcludedUser({
            requestedName: matchedTags.join(", "),
            userId: reportedUser.userId,
            userName: reportedUser.userName,
            reportedHours: reportedUser.reportedHours,
            resolvedFrom: "time_reports",
          }, "user_tag", matchedTags);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const historicalTags = getHistoricalUserTagNames(
          reportedUser.userId
        );
        const matchedHistoricalTags = getMatchingTagNames(
          historicalTags,
          cleanedUserTags
        );

        if (matchedHistoricalTags.length > 0) {
          addExcludedUser({
            requestedName: matchedHistoricalTags.join(", "),
            userId: reportedUser.userId,
            userName: reportedUser.userName,
            reportedHours: reportedUser.reportedHours,
            resolvedFrom: "historical_tag_registry",
          }, "user_tag", matchedHistoricalTags);
          continue;
        }

        warnings.push(
          `Could not inspect user tags for '${reportedUser.userName}' (ID ${reportedUser.userId}): ${message}. No matching historical tags are configured.`
        );
      }
    }
  }

  const excludedUsers = [...excludedUsersById.values()]
    .map((user) => ({
      ...user,
      exclusionSources: [...user.exclusionSources].sort(),
      matchedTags: [...user.matchedTags].sort((a, b) =>
        a.localeCompare(b, "sv")
      ),
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName, "sv"));

  const excludedReportedHours = excludedUsers.reduce(
    (sum, user) => sum + user.reportedHours,
    0
  );

  if (excludedReportedHours > totalReportedHours + 0.01) {
    throw new Error(
      "The excluded reported hours are greater than the project's total reported hours. Check that Blikk is applying the user filter correctly."
    );
  }

  const adjustedReportedHours =
    totalReportedHours - excludedReportedHours;

  const metrics = calculateBudgetMetrics(
    context,
    adjustedReportedHours
  );

  return {
    budgetLogicVersion: "budget-types-v1",
    requestedProject: projectName,
    projectId: project.id,
    budgetType: context.budgetType,
    budgetTag: context.budgetTag,
    budgetStatusReliable: context.budgetStatusReliable,
    isUnlimited: context.isUnlimited,
    configuredBudgetHours: round(context.configuredBudgetHours),
    budgetHours:
      context.effectiveBudgetHours === null
        ? null
        : round(context.effectiveBudgetHours),
    effectiveBudgetHours:
      context.effectiveBudgetHours === null
        ? null
        : round(context.effectiveBudgetHours),
    period: context.period,
    totalReportedHours: round(totalReportedHours),
    excludedReportedHours: round(excludedReportedHours),
    adjustedReportedHours: round(adjustedReportedHours),
    ...metrics,
    excludedUserTags: cleanedUserTags,
    excludedUsers,
    warnings,
  };
}

function createSuccessfulItem(
  project: ProjectCatalogItem,
  budgetStatus: ProjectBudgetStatus
): ActiveProjectBudgetItem {
  return {
    budgetLogicVersion: budgetStatus.budgetLogicVersion,
    projectId: project.id,
    orderNumber: project.orderNumber,
    project: project.title,
    customerName: project.customerName,
    status: project.status,
    projectManagerId: project.projectManagerId,
    projectManagerName: project.projectManagerName,
    budgetType: budgetStatus.budgetType,
    budgetTag: budgetStatus.budgetTag,
    budgetStatusReliable: budgetStatus.budgetStatusReliable,
    isUnlimited: budgetStatus.isUnlimited,
    configuredBudgetHours: budgetStatus.configuredBudgetHours,
    budgetHours: budgetStatus.budgetHours,
    effectiveBudgetHours: budgetStatus.effectiveBudgetHours,
    period: budgetStatus.period,
    reportedHours: budgetStatus.reportedHours,
    remainingHours: budgetStatus.remainingHours,
    usedPercent: budgetStatus.usedPercent,
    remainingPercent: budgetStatus.remainingPercent,
    isOverBudget: budgetStatus.isOverBudget,
    overBudgetHours: budgetStatus.overBudgetHours,
    warnings: budgetStatus.warnings,
    error: null,
  };
}

function createFailedItem(
  project: ProjectCatalogItem,
  error: unknown
): ActiveProjectBudgetItem {
  return {
    budgetLogicVersion: null,
    projectId: project.id,
    orderNumber: project.orderNumber,
    project: project.title,
    customerName: project.customerName,
    status: project.status,
    projectManagerId: project.projectManagerId,
    projectManagerName: project.projectManagerName,
    budgetType: null,
    budgetTag: null,
    budgetStatusReliable: null,
    isUnlimited: null,
    configuredBudgetHours: null,
    budgetHours: null,
    effectiveBudgetHours: null,
    period: null,
    reportedHours: null,
    remainingHours: null,
    usedPercent: null,
    remainingPercent: null,
    isOverBudget: null,
    overBudgetHours: null,
    warnings: [],
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
      const budgetStatus = await getProjectBudgetStatusForProject(
        project,
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
    unlimitedProjects: successfulProjects.filter(
      (project) => project.isUnlimited === true
    ).length,
    unclassifiedProjects: successfulProjects.filter(
      (project) => project.budgetType === "unknown"
    ).length,
    projectsWithWarnings: successfulProjects.filter(
      (project) => project.warnings.length > 0
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

export async function auditProjectBudgetTags(
  activeOnly = true
): Promise<BudgetTagAuditReport> {
  const allProjects = await getProjectCatalog();
  const selectedProjects = allProjects
    .filter((project) => !activeOnly || project.isCompleted === false)
    .sort((a, b) => a.title.localeCompare(b.title, "sv"));

  const items: BudgetTagAuditItem[] = selectedProjects.map((project) => {
    const matches = project.tags
      .map((tag) => ({
        tag: tag.name,
        budgetType: BUDGET_TAGS[normalizeTagName(tag.name)],
      }))
      .filter(
        (match): match is { tag: string; budgetType: BudgetType } =>
          Boolean(match.budgetType)
      );

    const auditStatus: BudgetTagAuditStatus =
      matches.length === 0
        ? "missing"
        : matches.length === 1
          ? "valid"
          : "multiple";

    const warning =
      auditStatus === "missing"
        ? "Projektet saknar budgetetikett. Lägg till Timbank, Projekt, Retainer eller Löpande."
        : auditStatus === "multiple"
          ? `Projektet har flera budgetetiketter: ${matches
              .map((match) => match.tag)
              .join(", ")}. Behåll exakt en.`
          : null;

    return {
      projectId: project.id,
      orderNumber: project.orderNumber,
      project: project.title,
      customerName: project.customerName,
      status: project.status,
      isCompleted: project.isCompleted,
      allTags: project.tags.map((tag) => tag.name),
      matchedBudgetTags: matches.map((match) => match.tag),
      budgetTypes: matches.map((match) => match.budgetType),
      auditStatus,
      warning,
    };
  });

  const valid = items.filter((item) => item.auditStatus === "valid");
  const missing = items.filter((item) => item.auditStatus === "missing");
  const multiple = items.filter(
    (item) => item.auditStatus === "multiple"
  );

  const countType = (budgetType: BudgetType): number =>
    valid.filter((item) => item.budgetTypes[0] === budgetType).length;

  return {
    budgetLogicVersion: "budget-types-v1",
    generatedAt: new Date().toISOString(),
    scope: activeOnly ? "active_projects" : "all_projects",
    validBudgetTags: ["Timbank", "Projekt", "Retainer", "Löpande"],
    totalProjects: items.length,
    validProjects: valid.length,
    missingBudgetTagProjects: missing.length,
    multipleBudgetTagProjects: multiple.length,
    countsByBudgetType: {
      timbank: countType("timbank"),
      project: countType("project"),
      retainer: countType("retainer"),
      ongoing: countType("ongoing"),
    },
    valid,
    missing,
    multiple,
  };
}
