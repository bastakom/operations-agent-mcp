import { get, put } from "@vercel/blob";
import {
  getAllOpportunities,
  getContact,
  getTimeReports,
  type BlikkRawItem,
  type PagedResponse,
} from "./endpoints";
import { toSafeContact, type SafeContact } from "./contacts";
import { toSafeOpportunity } from "./opportunities";
import { getProjectCatalog, type ProjectCatalogItem } from "./resolvers";

const STATE_PATH = "dormant-customers/build-state.json";
const INDEX_PATH = "dormant-customers/index.json";
const REQUESTS_PER_BATCH = 3;
const REQUEST_DELAY_MS = 1100;

type BuildPhase = "time_reports" | "contacts" | "complete";

type BuildState = {
  version: 2;
  buildId: string;
  phase: BuildPhase;
  startedAt: string;
  updatedAt: string;
  years: number;
  cutoffDate: string;
  candidates: ProjectCatalogItem[];
  nextProjectIndex: number;
  dormantProjects: ProjectCatalogItem[];
  verificationFailures: Array<{ projectId: string; project: string; error: string }>;
  opportunities: BlikkRawItem[];
  customers: Array<{ customerId: string; customerName: string; projects: ProjectCatalogItem[] }>;
  nextCustomerIndex: number;
  contacts: Record<string, SafeContact | null>;
  warnings: string[];
};

export type DormantCustomerIndex = {
  version: 2;
  generatedAt: string;
  buildId: string;
  methodology: {
    years: number;
    cutoffDate: string;
    dateBasis: "project.endDate";
    timeBasis: "no time reports found for the project across all dates";
    scoreIsRecommendationNotFact: true;
  };
  counts: {
    completedProjectsInPeriod: number;
    completedProjectsWithNoTime: number;
    recommendedCustomers: number;
    verificationFailures: number;
  };
  recommendations: Array<Record<string, unknown>>;
  warnings: string[];
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapRateLimited<T, R>(items: T[], mapper: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += REQUESTS_PER_BATCH) {
    if (index > 0) await wait(REQUEST_DELAY_MS);
    results.push(
      ...(await Promise.allSettled(
        items.slice(index, index + REQUESTS_PER_BATCH).map(mapper)
      ))
    );
  }
  return results;
}

function dateOnly(value: string | null): string | null {
  const result = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function subtractYears(date: Date, years: number) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result.toISOString().slice(0, 10);
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text()) as T;
}

async function writeJson(pathname: string, value: unknown) {
  await put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

async function createState(years: number): Promise<BuildState> {
  const now = new Date();
  const cutoffDate = subtractYears(now, years);
  const projects = await getProjectCatalog();
  const candidates = projects.filter((project) => {
    const endDate = dateOnly(project.endDate);
    return project.isCompleted === true && endDate !== null && endDate >= cutoffDate;
  });

  return {
    version: 2,
    buildId: crypto.randomUUID(),
    phase: "time_reports",
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    years,
    cutoffDate,
    candidates,
    nextProjectIndex: 0,
    dormantProjects: [],
    verificationFailures: [],
    opportunities: [],
    customers: [],
    nextCustomerIndex: 0,
    contacts: {},
    warnings: [],
  };
}

function groupCustomers(projects: ProjectCatalogItem[]) {
  const groups = new Map<string, { customerId: string; customerName: string; projects: ProjectCatalogItem[] }>();
  for (const project of projects) {
    if (!project.customerId || !project.customerName) continue;
    const current = groups.get(project.customerId) ?? {
      customerId: project.customerId,
      customerName: project.customerName,
      projects: [],
    };
    current.projects.push(project);
    groups.set(project.customerId, current);
  }
  return [...groups.values()];
}

function score(projectCount: number, latestEndDate: string, open: number, lost: number, contact: SafeContact | null) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(`${latestEndDate}T00:00:00Z`).getTime()) / 86_400_000));
  return Math.min(
    100,
    25 + Math.min(30, projectCount * 10) + Math.max(0, 20 - Math.floor(days / 55)) +
      (open === 0 ? 15 : 0) + (lost > 0 ? 5 : 0) +
      (contact?.email || contact?.phoneNumber || contact?.cellPhoneNumber ? 5 : 0)
  );
}

function buildIndex(state: BuildState): DormantCustomerIndex {
  const opportunities = state.opportunities.map(toSafeOpportunity);
  const recommendations = state.customers.map((customer) => {
    const history = opportunities.filter((item) => item.customer?.id === customer.customerId);
    const open = history.filter((item) => item.state === "open");
    const won = history.filter((item) => item.state === "won");
    const lost = history.filter((item) => item.state === "lost");
    const latestEndDate = customer.projects
      .map((project) => dateOnly(project.endDate))
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) as string;
    const contact = state.contacts[customer.customerId] ?? null;

    return {
      rankScore: score(customer.projects.length, latestEndDate, open.length, lost.length, contact),
      customerId: customer.customerId,
      customerName: customer.customerName,
      contact,
      reasons: [
        `${customer.projects.length} completed project(s) with no reported time`,
        `latest project ended ${latestEndDate}`,
        open.length === 0 ? "no open opportunity exists" : `${open.length} open opportunity/opportunities already exist`,
        lost.length > 0 ? `${lost.length} lost opportunity/opportunities may be worth revisiting` : null,
      ].filter(Boolean),
      projects: customer.projects,
      opportunityHistory: { open, won, lost },
    };
  }).sort((a, b) => b.rankScore - a.rankScore);

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    buildId: state.buildId,
    methodology: {
      years: state.years,
      cutoffDate: state.cutoffDate,
      dateBasis: "project.endDate",
      timeBasis: "no time reports found for the project across all dates",
      scoreIsRecommendationNotFact: true,
    },
    counts: {
      completedProjectsInPeriod: state.candidates.length,
      completedProjectsWithNoTime: state.dormantProjects.length,
      recommendedCustomers: recommendations.length,
      verificationFailures: state.verificationFailures.length,
    },
    recommendations,
    warnings: state.warnings,
  };
}

export async function refreshDormantCustomerIndex(options: {
  years?: number;
  batchSize?: number;
  reset?: boolean;
}) {
  const years = options.years ?? 3;
  const batchSize = Math.min(Math.max(options.batchSize ?? 18, 1), 30);
  let state = options.reset ? null : await readJson<BuildState>(STATE_PATH);
  if (!state || state.version !== 2 || state.years !== years) {
    state = await createState(years);
  }

  if (state.phase === "complete") {
    return {
      buildId: state.buildId,
      phase: state.phase,
      complete: true,
      progress: {
        processed: state.customers.length,
        total: state.customers.length,
        unit: "customers",
      },
      verificationFailures: state.verificationFailures.length,
      nextAction: "The index is ready. Use get_dormant_customer_opportunities.",
    };
  }

  if (state.phase === "time_reports") {
    const batch = state.candidates.slice(state.nextProjectIndex, state.nextProjectIndex + batchSize);
    const checks = await mapRateLimited(batch, async (project) => {
      const reports = (await getTimeReports({ projectId: project.id, page: 1, pageSize: 1 })) as PagedResponse;
      return reports.totalItemCount === 0;
    });
    checks.forEach((result, index) => {
      const project = batch[index];
      if (result.status === "fulfilled" && result.value) state!.dormantProjects.push(project);
      if (result.status === "rejected") {
        state!.verificationFailures.push({
          projectId: project.id,
          project: project.title,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    state.nextProjectIndex += batch.length;

    if (state.nextProjectIndex >= state.candidates.length) {
      state.opportunities = (await getAllOpportunities({ sortBy: "updatedDate", sortOrder: "descending" })).items;
      state.customers = groupCustomers(state.dormantProjects);
      state.phase = "contacts";
    }
  } else if (state.phase === "contacts") {
    const batch = state.customers.slice(state.nextCustomerIndex, state.nextCustomerIndex + batchSize);
    const contacts = await mapRateLimited(batch, async (customer) =>
      toSafeContact(await getContact(customer.customerId))
    );
    contacts.forEach((result, index) => {
      const customer = batch[index];
      if (result.status === "fulfilled") state!.contacts[customer.customerId] = result.value;
      else {
        state!.contacts[customer.customerId] = null;
        state!.warnings.push(`Could not fetch contact for '${customer.customerName}': ${String(result.reason)}`);
      }
    });
    state.nextCustomerIndex += batch.length;

    if (state.nextCustomerIndex >= state.customers.length) {
      state.phase = "complete";
      const index = buildIndex(state);
      await writeJson(INDEX_PATH, index);
    }
  }

  state.updatedAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);

  return {
    buildId: state.buildId,
    phase: state.phase,
    complete: state.phase === "complete",
    progress: state.phase === "time_reports"
      ? { processed: state.nextProjectIndex, total: state.candidates.length, unit: "projects" }
      : { processed: state.nextCustomerIndex, total: state.customers.length, unit: "customers" },
    verificationFailures: state.verificationFailures.length,
    nextAction: state.phase === "complete"
      ? "The index is ready. Use get_dormant_customer_opportunities."
      : "Call refresh_dormant_customer_index again with the same years value.",
  };
}

export async function getDormantCustomerOpportunities(options: {
  customer?: string;
  limit?: number;
} | number = {}) {
  const normalizedOptions = typeof options === "number" ? {} : options;
  const index = await readJson<DormantCustomerIndex>(INDEX_PATH);
  if (!index) {
    throw new Error("No completed dormant customer index exists. Run refresh_dormant_customer_index until complete is true.");
  }
  const query = normalizedOptions.customer?.trim().toLocaleLowerCase("sv");
  const recommendations = index.recommendations
    .filter((item) => !query || String(item.customerName ?? "").toLocaleLowerCase("sv").includes(query))
    .slice(0, Math.min(Math.max(normalizedOptions.limit ?? 25, 1), 100));
  return { ...index, returnedRecommendations: recommendations.length, recommendations };
}

export async function analyzeCustomerOpportunity(projectQuery: string) {
  const normalized = projectQuery.trim().toLocaleLowerCase("sv");
  const matches = (await getProjectCatalog()).filter((project) =>
    project.title.toLocaleLowerCase("sv").includes(normalized)
  );
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `No project matched '${projectQuery}'.`
      : `Project query '${projectQuery}' is ambiguous: ${matches.map((item) => item.title).join(", ")}`);
  }
  const project = matches[0];
  const reports = (await getTimeReports({ projectId: project.id, page: 1, pageSize: 1 })) as PagedResponse;
  const opportunities = (await getAllOpportunities()).items
    .map(toSafeOpportunity)
    .filter((item) => item.customer?.id === project.customerId);
  const contact = project.customerId
    ? toSafeContact(await getContact(project.customerId))
    : null;

  return {
    project,
    qualification: {
      isCompleted: project.isCompleted,
      endDate: project.endDate,
      hasReportedTime: reports.totalItemCount > 0,
      timeReportCount: reports.totalItemCount,
      qualifiesAsDormantProject: project.isCompleted === true && reports.totalItemCount === 0,
    },
    customer: { id: project.customerId, name: project.customerName, contact },
    opportunityHistory: {
      open: opportunities.filter((item) => item.state === "open"),
      won: opportunities.filter((item) => item.state === "won"),
      lost: opportunities.filter((item) => item.state === "lost"),
    },
  };
}
