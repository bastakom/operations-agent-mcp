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
const INDEX_VERSION = 3;

type BuildPhase = "time_reports" | "contacts" | "complete";
type CustomerGroup = {
  customerId: string;
  customerName: string;
  projects: ProjectCatalogItem[];
};
type CustomerContacts = {
  companyContact: SafeContact | null;
  meetingContact: SafeContact | null;
  meetingContactSource: "primary_contact_person" | "contact_person" | "none";
};
type BuildState = {
  version: 3;
  buildId: string;
  phase: BuildPhase;
  startedAt: string;
  updatedAt: string;
  years: number;
  cutoffDate: string;
  upperDate: string;
  candidates: ProjectCatalogItem[];
  futureDatedCompletedProjects: ProjectCatalogItem[];
  excludedProjects: ProjectCatalogItem[];
  nextProjectIndex: number;
  dormantProjects: ProjectCatalogItem[];
  verificationFailures: Array<{ projectId: string; project: string; error: string }>;
  opportunities: BlikkRawItem[];
  customers: CustomerGroup[];
  nextCustomerIndex: number;
  contacts: Record<string, CustomerContacts>;
  warnings: string[];
};

export type DormantCustomerIndex = {
  version: 3;
  generatedAt: string;
  buildId: string;
  methodology: {
    years: number;
    cutoffDate: string;
    upperDate: string;
    dateBasis: "project.endDate";
    timeBasis: "no time reports found for the project across all dates";
    scoreIsRecommendationNotFact: true;
  };
  counts: {
    completedProjectsInPeriod: number;
    completedProjectsWithNoTime: number;
    recommendedCustomers: number;
    verificationFailures: number;
    futureDatedCompletedProjects: number;
    excludedProjects: number;
  };
  dataQuality: {
    futureDatedCompletedProjects: Array<Record<string, unknown>>;
    excludedProjects: Array<Record<string, unknown>>;
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

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("sv");
}

function configuredSet(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map(normalize)
      .filter(Boolean)
  );
}

function isExcludedProject(project: ProjectCatalogItem) {
  const excludedIds = configuredSet("DORMANT_CUSTOMER_EXCLUDED_IDS");
  const excludedNames = configuredSet("DORMANT_CUSTOMER_EXCLUDED_NAMES");
  const hasNoindex = project.tags.some((tag) => normalize(tag.name) === "noindex");
  return (
    hasNoindex ||
    (project.customerId !== null && excludedIds.has(normalize(project.customerId))) ||
    (project.customerName !== null && excludedNames.has(normalize(project.customerName)))
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function selectContactPersonId(companyDetail: BlikkRawItem) {
  if (!Array.isArray(companyDetail.contactPersons)) return null;
  const contacts = companyDetail.contactPersons
    .map(record)
    .filter((item): item is Record<string, unknown> => item !== null);
  const selected = contacts.find((item) => item.isPrimary === true) ?? contacts[0];
  return selected
    ? {
        id: text(selected.id),
        source: selected.isPrimary === true
          ? ("primary_contact_person" as const)
          : ("contact_person" as const),
      }
    : null;
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
  const upperDate = now.toISOString().slice(0, 10);
  const projects = await getProjectCatalog();
  const futureDatedCompletedProjects: ProjectCatalogItem[] = [];
  const excludedProjects: ProjectCatalogItem[] = [];
  const candidates: ProjectCatalogItem[] = [];

  for (const project of projects) {
    if (project.isCompleted !== true) continue;
    const endDate = dateOnly(project.endDate);
    if (!endDate || endDate < cutoffDate) continue;
    if (endDate > upperDate) {
      futureDatedCompletedProjects.push(project);
      continue;
    }
    if (isExcludedProject(project)) {
      excludedProjects.push(project);
      continue;
    }
    candidates.push(project);
  }

  return {
    version: 3,
    buildId: crypto.randomUUID(),
    phase: "time_reports",
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    years,
    cutoffDate,
    upperDate,
    candidates,
    futureDatedCompletedProjects,
    excludedProjects,
    nextProjectIndex: 0,
    dormantProjects: [],
    verificationFailures: [],
    opportunities: [],
    customers: [],
    nextCustomerIndex: 0,
    contacts: {},
    warnings: futureDatedCompletedProjects.length > 0
      ? [`${futureDatedCompletedProjects.length} completed project(s) had a future end date and were excluded.`]
      : [],
  };
}

function groupCustomers(projects: ProjectCatalogItem[]) {
  const groups = new Map<string, CustomerGroup>();
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
  const days = Math.max(0, Math.floor(
    (Date.now() - new Date(`${latestEndDate}T00:00:00Z`).getTime()) / 86_400_000
  ));
  return Math.min(
    100,
    25 + Math.min(30, projectCount * 10) + Math.max(0, 20 - Math.floor(days / 55)) +
      (open === 0 ? 15 : 0) + (lost > 0 ? 5 : 0) +
      (contact?.email || contact?.phoneNumber || contact?.cellPhoneNumber ? 5 : 0)
  );
}

function compactProject(project: ProjectCatalogItem) {
  return {
    id: project.id,
    orderNumber: project.orderNumber,
    title: project.title,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    customerId: project.customerId,
    customerName: project.customerName,
    projectManagerName: project.projectManagerName,
  };
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
    const contacts = state.contacts[customer.customerId] ?? {
      companyContact: null,
      meetingContact: null,
      meetingContactSource: "none" as const,
    };

    return {
      rankScore: score(
        customer.projects.length,
        latestEndDate,
        open.length,
        lost.length,
        contacts.meetingContact
      ),
      customerId: customer.customerId,
      customerName: customer.customerName,
      meetingContact: contacts.meetingContact,
      meetingContactSource: contacts.meetingContactSource,
      companyContact: contacts.companyContact,
      invoiceEmail: contacts.companyContact?.invoiceEmail ?? null,
      contactGuidance: contacts.meetingContact
        ? "Use meetingContact for outreach. invoiceEmail is informational only."
        : "No person contact was resolved. Coordinate outreach through the internal responsible user; do not use invoiceEmail for meeting invitations.",
      reasons: [
        `${customer.projects.length} completed project(s) with no reported time`,
        `latest project ended ${latestEndDate}`,
        open.length === 0 ? "no open opportunity exists" : `${open.length} open opportunity/opportunities already exist`,
        lost.length > 0 ? `${lost.length} lost opportunity/opportunities may be worth revisiting` : null,
      ].filter(Boolean),
      projects: customer.projects.map(compactProject),
      opportunityHistory: { open, won, lost },
    };
  }).sort((a, b) => b.rankScore - a.rankScore);

  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    buildId: state.buildId,
    methodology: {
      years: state.years,
      cutoffDate: state.cutoffDate,
      upperDate: state.upperDate,
      dateBasis: "project.endDate",
      timeBasis: "no time reports found for the project across all dates",
      scoreIsRecommendationNotFact: true,
    },
    counts: {
      completedProjectsInPeriod: state.candidates.length,
      completedProjectsWithNoTime: state.dormantProjects.length,
      recommendedCustomers: recommendations.length,
      verificationFailures: state.verificationFailures.length,
      futureDatedCompletedProjects: state.futureDatedCompletedProjects.length,
      excludedProjects: state.excludedProjects.length,
    },
    dataQuality: {
      futureDatedCompletedProjects: state.futureDatedCompletedProjects.map(compactProject),
      excludedProjects: state.excludedProjects.map(compactProject),
    },
    recommendations,
    warnings: state.warnings,
  };
}

export async function refreshDormantCustomerIndex(options: {
  years?: number;
  batchSize?: number;
  reset?: boolean;
  autoResetAfterHours?: number;
}) {
  const years = options.years ?? 3;
  const batchSize = Math.min(Math.max(options.batchSize ?? 18, 1), 30);
  let state = options.reset ? null : await readJson<BuildState>(STATE_PATH);
  if (!state || state.version !== INDEX_VERSION || state.years !== years) {
    state = await createState(years);
  }

  if (state.phase === "complete") {
    const maxAge = options.autoResetAfterHours;
    const ageHours = (Date.now() - new Date(state.updatedAt).getTime()) / 3_600_000;
    if (typeof maxAge === "number" && ageHours >= maxAge) {
      state = await createState(years);
    } else {
      return {
        buildId: state.buildId,
        phase: state.phase,
        complete: true,
        progress: { processed: state.customers.length, total: state.customers.length, unit: "customers" },
        verificationFailures: state.verificationFailures.length,
        nextAction: "The index is ready. Use get_dormant_customer_opportunities.",
      };
    }
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
      state.opportunities = (await getAllOpportunities({
        sortBy: "updatedDate",
        sortOrder: "descending",
      })).items;
      state.customers = groupCustomers(state.dormantProjects);
      state.phase = "contacts";
    }
  } else if (state.phase === "contacts") {
    const batch = state.customers.slice(state.nextCustomerIndex, state.nextCustomerIndex + batchSize);
    const contacts = await mapRateLimited(batch, async (customer): Promise<CustomerContacts> => {
      const companyDetail = await getContact(customer.customerId);
      const companyContact = toSafeContact(companyDetail);
      const person = selectContactPersonId(companyDetail);
      if (!person?.id) {
        return { companyContact, meetingContact: null, meetingContactSource: "none" };
      }
      await wait(REQUEST_DELAY_MS);
      const meetingContact = toSafeContact(await getContact(person.id));
      return {
        companyContact,
        meetingContact,
        meetingContactSource: person.source,
      };
    });
    contacts.forEach((result, index) => {
      const customer = batch[index];
      if (result.status === "fulfilled") {
        state!.contacts[customer.customerId] = result.value;
      } else {
        state!.contacts[customer.customerId] = {
          companyContact: null,
          meetingContact: null,
          meetingContactSource: "none",
        };
        state!.warnings.push(
          `Could not fetch contacts for '${customer.customerName}': ${String(result.reason)}`
        );
      }
    });
    state.nextCustomerIndex += batch.length;

    if (state.nextCustomerIndex >= state.customers.length) {
      state.phase = "complete";
      await writeJson(INDEX_PATH, buildIndex(state));
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
    futureDatedCompletedProjects:
      state.futureDatedCompletedProjects?.length ?? 0,
    excludedProjects: state.excludedProjects?.length ?? 0,
    nextAction: state.phase === "complete"
      ? "The index is ready. Use get_dormant_customer_opportunities."
      : "Wait for the next cron run or call refresh_dormant_customer_index again.",
  };
}

export async function getDormantCustomerOpportunities(options: {
  customer?: string;
  limit?: number;
} | number = {}) {
  const normalizedOptions = typeof options === "number" ? {} : options;
  const index = await readJson<DormantCustomerIndex>(INDEX_PATH);
  if (!index) {
    throw new Error("No completed dormant customer index exists yet.");
  }
  const query = normalizedOptions.customer?.trim().toLocaleLowerCase("sv");
  const recommendations = index.recommendations
    .filter((item) => !query || String(item.customerName ?? "").toLocaleLowerCase("sv").includes(query))
    .slice(0, Math.min(Math.max(normalizedOptions.limit ?? 25, 1), 100));
  return { ...index, returnedRecommendations: recommendations.length, recommendations };
}

export async function getDormantCustomerIndexStatus() {
  const state = await readJson<BuildState>(STATE_PATH);
  const index = await readJson<DormantCustomerIndex>(INDEX_PATH);
  if (!state) {
    return {
      exists: false,
      complete: false,
      phase: null,
      progress: null,
      percentComplete: 0,
      lastUpdatedAt: null,
      latestCompletedIndexAt: index?.generatedAt ?? null,
      message: "No build state exists yet. Wait for the cron job.",
    };
  }
  const isProjectPhase = state.phase === "time_reports";
  const processed = isProjectPhase
    ? state.nextProjectIndex ?? 0
    : state.nextCustomerIndex ?? 0;
  const total = isProjectPhase
    ? state.candidates?.length ?? 0
    : state.customers?.length ?? 0;
  const percentComplete = state.phase === "complete"
    ? 100
    : total === 0
      ? 0
      : Math.min(99.9, Math.round((processed / total) * 1000) / 10);
  return {
    exists: true,
    version: state.version,
    buildId: state.buildId,
    phase: state.phase,
    complete: state.phase === "complete",
    progress: {
      processed,
      total,
      remaining: Math.max(total - processed, 0),
      unit: isProjectPhase ? "projects" : "customers",
    },
    percentComplete,
    startedAt: state.startedAt,
    lastUpdatedAt: state.updatedAt,
    years: state.years,
    cutoffDate: state.cutoffDate,
    upperDate: state.upperDate,
    dormantProjectsFound: state.dormantProjects?.length ?? 0,
    verificationFailures: state.verificationFailures?.length ?? 0,
    futureDatedCompletedProjects:
      state.futureDatedCompletedProjects?.length ?? 0,
    excludedProjects: state.excludedProjects?.length ?? 0,
    warningCount: state.warnings?.length ?? 0,
    latestCompletedIndexAt: index?.generatedAt ?? null,
    latestCompletedIndexBuildId: index?.buildId ?? null,
    servingPreviousCompletedIndex:
      index !== null && index.buildId !== state.buildId && state.phase !== "complete",
  };
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
  const companyDetail = project.customerId ? await getContact(project.customerId) : null;
  const companyContact = companyDetail ? toSafeContact(companyDetail) : null;
  const person = companyDetail ? selectContactPersonId(companyDetail) : null;
  const meetingContact = person?.id
    ? toSafeContact(await getContact(person.id))
    : null;

  return {
    project,
    qualification: {
      isCompleted: project.isCompleted,
      endDate: project.endDate,
      hasReportedTime: reports.totalItemCount > 0,
      timeReportCount: reports.totalItemCount,
      qualifiesAsDormantProject:
        project.isCompleted === true &&
        reports.totalItemCount === 0 &&
        dateOnly(project.endDate) !== null &&
        (dateOnly(project.endDate) as string) <= new Date().toISOString().slice(0, 10),
    },
    customer: {
      id: project.customerId,
      name: project.customerName,
      meetingContact,
      companyContact,
      contactGuidance: meetingContact
        ? "Use meetingContact for outreach."
        : "No person contact was resolved; do not use invoiceEmail for meeting invitations.",
    },
    opportunityHistory: {
      open: opportunities.filter((item) => item.state === "open"),
      won: opportunities.filter((item) => item.state === "won"),
      lost: opportunities.filter((item) => item.state === "lost"),
    },
  };
}
