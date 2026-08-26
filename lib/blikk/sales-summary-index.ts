import { get, put } from "@vercel/blob";
import {
  getAllCustomerInvoices,
  getAllOpportunities,
  getOpportunity,
} from "./endpoints";
import { toSafeOpportunity } from "./opportunities";
import { getProjectCatalog, type ProjectCatalogItem } from "./resolvers";
import {
  getOfferPipeline,
  toSafeCustomerInvoice,
  type SafeCustomerInvoice,
  type SafeOffer,
} from "./sales";
import {
  resolveSalesCustomerContacts,
  type SalesCustomerContact,
  type SalesCustomerContactFailure,
  type SalesCustomerReference,
} from "./sales-summary-contacts";
import {
  buildSalesAttention,
  type SalesAttentionResult,
} from "./sales-summary-attention";
import {
  buildSalesDataQuality,
  type SalesDataQualityResult,
} from "./sales-summary-quality";

const STATE_PATH = "sales-summary/build-state.json";
const INDEX_PATH = "sales-summary/index.json";
const SNAPSHOT_PREFIX = "sales-summary/weekly";
const INDEX_VERSION = 2;
const DETAIL_DELAY_MS = 1100;

type SafeOpportunity = ReturnType<typeof toSafeOpportunity>;
type BuildPhase =
  | "projects"
  | "invoices"
  | "opportunities"
  | "opportunity_details"
  | "offers"
  | "contacts"
  | "aggregate"
  | "complete";

type DataQualityFlag = {
  code: string;
  severity: "warning" | "error";
  entityType: "customer" | "project" | "opportunity" | "offer";
  entityId: string;
  message: string;
};

type BuildState = {
  version: 2;
  buildId: string;
  phase: BuildPhase;
  startedAt: string;
  updatedAt: string;
  reportYear: number;
  projects: ProjectCatalogItem[];
  invoices: SafeCustomerInvoice[];
  opportunities: SafeOpportunity[];
  nextOpportunityDetailIndex: number;
  opportunityDetailFailures: Array<{
    opportunityId: string;
    title: string;
    error: string;
  }>;
  offers: SafeOffer[];
  customerReferences: SalesCustomerReference[];
  nextCustomerContactIndex: number;
  contacts: Record<string, SalesCustomerContact>;
  contactFailures: SalesCustomerContactFailure[];
  warnings: string[];
};

export type SalesSummaryCustomer = {
  customerId: string;
  customerName: string;
  customerNumber: string | null;
  responsible: { id: string | null; name: string | null } | null;
  responsibleSource:
    | "customer_contact"
    | "opportunity_project_offer_fallback"
    | "none";
  contact: {
    email: string | null;
    invoiceEmail: string | null;
    phoneNumber: string | null;
    cellPhoneNumber: string | null;
    isActive: boolean | null;
    importantInformation: string | null;
  } | null;
  historicalSales: Record<string, number>;
  invoicedCurrentYear: number;
  invoiceCountCurrentYear: number;
  soldNotInvoiced: null;
  annualBudget: null;
  activeProjects: ProjectCatalogItem[];
  openOpportunities: SafeOpportunity[];
  pipeline: number;
  weightedPipeline: number;
  opportunitiesWithProbability: number;
  activeOffers: SafeOffer[];
  acceptedOffers: SafeOffer[];
  acceptedOfferValue: number;
  preliminaryForecast: number;
  budgetGap: null;
  nextActivity: {
    source: "opportunity";
    opportunityId: string;
    title: string;
    status: string | null;
    date: string;
  } | null;
  bookedSalesMeetings: number;
  dataQuality: DataQualityFlag[];
};

type SalesTotals = {
  customers: number;
  invoiced: number;
  soldNotInvoiced: null;
  pipeline: number;
  weightedPipeline: number;
  preliminaryForecast: number;
  annualBudget: null;
  budgetGap: null;
  activeProjects: number;
  activeOpportunities: number;
  activeOffers: number;
  acceptedOffers: number;
  acceptedOfferValue: number;
  bookedSalesMeetings: number;
};

export type SalesSummaryIndex = {
  version: 2;
  generatedAt: string;
  buildId: string;
  reportYear: number;
  currency: "SEK";
  definitions: {
    invoiced: string;
    soldNotInvoiced: string;
    pipeline: string;
    weightedPipeline: string;
    preliminaryForecast: string;
  };
  totals: SalesTotals;
  byResponsible: Array<{
    responsibleId: string | null;
    responsibleName: string;
    totals: SalesTotals;
    customerIds: string[];
  }>;
  customers: SalesSummaryCustomer[];
  opportunityLedger: SafeOpportunity[];
  offerLedger: SafeOffer[];
  salesAttention: SalesAttentionResult;
  dataQuality: {
    flags: DataQualityFlag[];
    countsByCode: Record<string, number>;
    audit: SalesDataQualityResult;
    opportunityDetailFailures: BuildState["opportunityDetailFailures"];
    contactFailures: BuildState["contactFailures"];
  };
  warnings: string[];
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function createState(reportYear: number): BuildState {
  const now = new Date().toISOString();
  return {
    version: 2,
    buildId: crypto.randomUUID(),
    phase: "projects",
    startedAt: now,
    updatedAt: now,
    reportYear,
    projects: [],
    invoices: [],
    opportunities: [],
    nextOpportunityDetailIndex: 0,
    opportunityDetailFailures: [],
    offers: [],
    customerReferences: [],
    nextCustomerContactIndex: 0,
    contacts: {},
    contactFailures: [],
    warnings: [],
  };
}

function yearOf(value: string | null) {
  const match = value?.match(/^(\d{4})-/);
  return match ? match[1] : null;
}

function number(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isActiveOffer(offer: SafeOffer) {
  return ["locked", "sentToCustomer", "openedByCustomer"].includes(offer.state);
}

function isAcceptedOffer(offer: SafeOffer) {
  return ["accepted", "acceptedSigned"].includes(offer.state);
}

function isMeetingStatus(opportunity: SafeOpportunity) {
  const value = opportunity.status?.name?.toLocaleLowerCase("sv") ?? "";
  return value.includes("möte") || value.includes("meeting");
}

function responsibleForCustomer(
  projects: ProjectCatalogItem[],
  opportunities: SafeOpportunity[],
  offers: SafeOffer[]
) {
  const candidates = [
    ...opportunities.map((item) => item.responsible),
    ...projects.map((item) =>
      item.projectManagerId || item.projectManagerName
        ? { id: item.projectManagerId, name: item.projectManagerName }
        : null
    ),
    ...offers.map((item) => item.responsible),
  ].filter((item): item is { id: string | null; name: string | null } => item !== null);

  const counts = new Map<string, {
    value: { id: string | null; name: string | null };
    count: number;
  }>();
  for (const candidate of candidates) {
    const key = candidate.id ?? candidate.name ?? "";
    if (!key) continue;
    const current = counts.get(key) ?? { value: candidate, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? null;
}

function totalsFor(customers: SalesSummaryCustomer[]): SalesTotals {
  return {
    customers: customers.length,
    invoiced: customers.reduce((sum, item) => sum + item.invoicedCurrentYear, 0),
    soldNotInvoiced: null,
    pipeline: customers.reduce((sum, item) => sum + item.pipeline, 0),
    weightedPipeline: customers.reduce((sum, item) => sum + item.weightedPipeline, 0),
    preliminaryForecast: customers.reduce((sum, item) => sum + item.preliminaryForecast, 0),
    annualBudget: null,
    budgetGap: null,
    activeProjects: customers.reduce((sum, item) => sum + item.activeProjects.length, 0),
    activeOpportunities: customers.reduce((sum, item) => sum + item.openOpportunities.length, 0),
    activeOffers: customers.reduce((sum, item) => sum + item.activeOffers.length, 0),
    acceptedOffers: customers.reduce((sum, item) => sum + item.acceptedOffers.length, 0),
    acceptedOfferValue: customers.reduce((sum, item) => sum + item.acceptedOfferValue, 0),
    bookedSalesMeetings: customers.reduce((sum, item) => sum + item.bookedSalesMeetings, 0),
  };
}

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function collectCustomerNames(state: BuildState) {
  const customerNames = new Map<string, string>();

  for (const project of state.projects) {
    if (project.customerId) {
      customerNames.set(
        project.customerId,
        project.customerName ?? project.customerId
      );
    }
  }

  for (const invoice of state.invoices) {
    if (invoice.customer?.id) {
      customerNames.set(
        invoice.customer.id,
        invoice.customer.name ?? invoice.customer.id
      );
    }
  }

  for (const opportunity of state.opportunities) {
    if (opportunity.customer?.id) {
      customerNames.set(
        opportunity.customer.id,
        opportunity.customer.name ?? opportunity.customer.id
      );
    }
  }

  for (const offer of state.offers) {
    if (offer.customer?.id) {
      customerNames.set(
        offer.customer.id,
        offer.customer.name ?? offer.customer.id
      );
    }
  }

  return customerNames;
}

function buildCustomerReferences(
  state: BuildState
): SalesCustomerReference[] {
  return [...collectCustomerNames(state).entries()]
    .map(([customerId, customerName]) => ({
      customerId,
      customerName,
    }))
    .sort((a, b) =>
      a.customerName.localeCompare(
        b.customerName,
        "sv"
      )
    );
}

function buildIndex(state: BuildState): SalesSummaryIndex {
  const customerNames = collectCustomerNames(state);

  const today = new Date().toISOString().slice(0, 10);
  const allFlags: DataQualityFlag[] = state.projects
    .filter((project) => !project.customerId)
    .map((project) => ({
      entityType: "project" as const,
      entityId: project.id,
      code: "PROJECT_WITHOUT_CUSTOMER",
      severity: "error" as const,
      message: `Projektet ${project.title} saknar kundkoppling.`,
    }));
  const customers = [...customerNames.entries()].map(([customerId, customerName]) => {
    const projects = state.projects.filter((item) => item.customerId === customerId);
    const invoices = state.invoices.filter((item) => item.customer?.id === customerId);
    const opportunities = state.opportunities.filter((item) => item.customer?.id === customerId);
    const offers = state.offers.filter((item) => item.customer?.id === customerId);
    const openOpportunities = opportunities.filter((item) => item.state === "open");
    const activeProjects = projects.filter((item) => item.isCompleted !== true);
    const activeOffers = offers.filter(isActiveOffer);
    const acceptedOffers = offers.filter(isAcceptedOffer);
    const customerContact =
      state.contacts[customerId] ?? null;
    const fallbackResponsible = responsibleForCustomer(
      projects,
      opportunities,
      offers
    );
    const responsible =
      customerContact?.responsible ??
      fallbackResponsible;
    const responsibleSource =
      customerContact?.responsible
        ? ("customer_contact" as const)
        : fallbackResponsible
          ? ("opportunity_project_offer_fallback" as const)
          : ("none" as const);
    const historicalSales: Record<string, number> = {};

    for (const invoice of invoices) {
      const year = yearOf(invoice.invoiceDate);
      if (year) historicalSales[year] = (historicalSales[year] ?? 0) + invoice.amountExcludingVat;
    }

    const flags: DataQualityFlag[] = [];
    const addFlag = (flag: Omit<DataQualityFlag, "entityType" | "entityId"> & Partial<Pick<DataQualityFlag, "entityType" | "entityId">>) => {
      flags.push({
        entityType: flag.entityType ?? "customer",
        entityId: flag.entityId ?? customerId,
        code: flag.code,
        severity: flag.severity,
        message: flag.message,
      });
    };

    if (!responsible?.name) {
      addFlag({ code: "CUSTOMER_WITHOUT_RESPONSIBLE", severity: "warning", message: `${customerName} saknar ansvarig.` });
    }
    for (const opportunity of openOpportunities) {
      if (opportunity.turnover === null || opportunity.turnover <= 0) {
        addFlag({ entityType: "opportunity", entityId: opportunity.id, code: "OPEN_OPPORTUNITY_WITHOUT_VALUE", severity: "warning", message: `Affären ${opportunity.title} saknar värde.` });
      }
      if (opportunity.probability === null) {
        addFlag({ entityType: "opportunity", entityId: opportunity.id, code: "OPEN_OPPORTUNITY_WITHOUT_PROBABILITY", severity: "warning", message: `Affären ${opportunity.title} saknar sannolikhet.` });
      }
      if (!opportunity.estimatedClosingDate) {
        addFlag({ entityType: "opportunity", entityId: opportunity.id, code: "OPEN_OPPORTUNITY_WITHOUT_CLOSING_DATE", severity: "warning", message: `Affären ${opportunity.title} saknar förväntat beslutsdatum.` });
      }
    }
    allFlags.push(...flags);

    const pipeline = openOpportunities.reduce((sum, item) => sum + number(item.turnover), 0);
    const weightedPipeline = openOpportunities.reduce(
      (sum, item) => sum + number(item.turnover) * (number(item.probability) / 100),
      0
    );
    const datedActivities = openOpportunities
      .filter((item) => item.estimatedClosingDate)
      .sort((a, b) => (a.estimatedClosingDate ?? "").localeCompare(b.estimatedClosingDate ?? ""));
    const next = datedActivities.find((item) => (item.estimatedClosingDate ?? "") >= today) ?? datedActivities[0];
    const invoicedCurrentYear = historicalSales[String(state.reportYear)] ?? 0;

    return {
      customerId,
      customerName:
        customerContact?.customerName ??
        customerName,
      customerNumber:
        customerContact?.customerNumber ?? null,
      responsible,
      responsibleSource,
      contact: customerContact
        ? {
            email: customerContact.email,
            invoiceEmail:
              customerContact.invoiceEmail,
            phoneNumber:
              customerContact.phoneNumber,
            cellPhoneNumber:
              customerContact.cellPhoneNumber,
            isActive: customerContact.isActive,
            importantInformation:
              customerContact.importantInformation,
          }
        : null,
      historicalSales,
      invoicedCurrentYear,
      invoiceCountCurrentYear: invoices.filter((item) => yearOf(item.invoiceDate) === String(state.reportYear)).length,
      soldNotInvoiced: null,
      annualBudget: null,
      activeProjects,
      openOpportunities,
      pipeline,
      weightedPipeline,
      opportunitiesWithProbability: openOpportunities.filter((item) => item.probability !== null).length,
      activeOffers,
      acceptedOffers,
      acceptedOfferValue: acceptedOffers.reduce((sum, item) => sum + item.offerValue, 0),
      preliminaryForecast: invoicedCurrentYear + weightedPipeline,
      budgetGap: null,
      nextActivity: next?.estimatedClosingDate
        ? { source: "opportunity" as const, opportunityId: next.id, title: next.title, status: next.status?.name ?? null, date: next.estimatedClosingDate }
        : null,
      bookedSalesMeetings: openOpportunities.filter(isMeetingStatus).length,
      dataQuality: flags,
    } satisfies SalesSummaryCustomer;
  }).sort((a, b) => b.preliminaryForecast - a.preliminaryForecast);

  const groups = new Map<string, SalesSummaryCustomer[]>();
  for (const customer of customers) {
    const key = customer.responsible?.id ?? customer.responsible?.name ?? "unassigned";
    groups.set(key, [...(groups.get(key) ?? []), customer]);
  }
  const countsByCode: Record<string, number> = {};
  for (const flag of allFlags) {
    countsByCode[flag.code] =
      (countsByCode[flag.code] ?? 0) + 1;
  }
  const generatedAt = new Date().toISOString();
  const salesAttention = buildSalesAttention(
    customers,
    {
      reportYear: state.reportYear,
      generatedAt,
      staleOfferDays: 30,
      actionsPerResponsible: 5,
    }
  );
  const qualityAudit = buildSalesDataQuality({
    customers,
    projects: state.projects,
    opportunities: state.opportunities,
    offers: state.offers,
    generatedAt,
  });

  return {
    version: 2,
    generatedAt,
    buildId: state.buildId,
    reportYear: state.reportYear,
    currency: "SEK",
    definitions: {
      invoiced: "Customer invoices excluding VAT, grouped by invoiceDate.",
      soldNotInvoiced: "Not calculated in version 1; remains null until a verified order-stock source exists.",
      pipeline: "Turnover on open opportunities.",
      weightedPipeline: "Open opportunity turnover multiplied by probability.",
      preliminaryForecast: "Invoiced current year plus weighted pipeline. Sold but not invoiced is not yet included.",
    },
    totals: totalsFor(customers),
    byResponsible: [...groups.entries()].map(([key, items]) => ({
      responsibleId: key === "unassigned" ? null : items[0].responsible?.id ?? null,
      responsibleName: items[0].responsible?.name ?? "Ej tilldelad",
      totals: totalsFor(items),
      customerIds: items.map((item) => item.customerId),
    })).sort((a, b) => b.totals.preliminaryForecast - a.totals.preliminaryForecast),
    customers,
    opportunityLedger: state.opportunities,
    offerLedger: state.offers,
    salesAttention,
    dataQuality: {
      flags: allFlags,
      countsByCode,
      audit: qualityAudit,
      opportunityDetailFailures:
        state.opportunityDetailFailures,
      contactFailures: state.contactFailures,
    },
    warnings: state.warnings,
  };
}

async function persistCompletedIndex(index: SalesSummaryIndex) {
  await writeJson(INDEX_PATH, index);
  await writeJson(`${SNAPSHOT_PREFIX}/${isoWeek(new Date(index.generatedAt))}.json`, index);
}

export async function refreshSalesSummaryIndex(options: {
  reportYear?: number;
  opportunityBatchSize?: number;
  reset?: boolean;
  autoResetAfterHours?: number;
} = {}) {
  const reportYear = options.reportYear ?? new Date().getFullYear();
  const batchSize = Math.min(Math.max(options.opportunityBatchSize ?? 20, 1), 30);
  let state = options.reset ? null : await readJson<BuildState>(STATE_PATH);
  if (!state || state.version !== INDEX_VERSION || state.reportYear !== reportYear) state = createState(reportYear);

  if (state.phase === "complete") {
    const maxAge = options.autoResetAfterHours;
    const ageHours = (Date.now() - new Date(state.updatedAt).getTime()) / 3_600_000;
    if (typeof maxAge === "number" && ageHours >= maxAge) state = createState(reportYear);
    else return { buildId: state.buildId, phase: state.phase, complete: true, nextAction: "Sales Summary-indexet är klart." };
  }

  if (state.phase === "projects") {
    state.projects = await getProjectCatalog();
    state.phase = "invoices";
  } else if (state.phase === "invoices") {
    const response = await getAllCustomerInvoices({ sortBy: "invoiceDate", sortOrder: "descending" });
    state.invoices = response.items.map(toSafeCustomerInvoice);
    state.phase = "opportunities";
  } else if (state.phase === "opportunities") {
    const response = await getAllOpportunities({ sortBy: "updatedDate", sortOrder: "descending" });
    state.opportunities = response.items.map(toSafeOpportunity);
    state.phase = "opportunity_details";
  } else if (state.phase === "opportunity_details") {
    const batch = state.opportunities.slice(state.nextOpportunityDetailIndex, state.nextOpportunityDetailIndex + batchSize);
    for (const opportunity of batch) {
      try {
        const detail = await getOpportunity(opportunity.id);
        state.opportunities[state.nextOpportunityDetailIndex] = toSafeOpportunity(detail);
      } catch (error) {
        state.opportunityDetailFailures.push({ opportunityId: opportunity.id, title: opportunity.title, error: error instanceof Error ? error.message : String(error) });
      }
      state.nextOpportunityDetailIndex += 1;
      if (state.nextOpportunityDetailIndex < state.opportunities.length) await wait(DETAIL_DELAY_MS);
    }
    if (state.nextOpportunityDetailIndex >= state.opportunities.length) state.phase = "offers";
  } else if (state.phase === "offers") {
    state.offers = (await getOfferPipeline()).offers;
    state.customerReferences =
      buildCustomerReferences(state);
    state.phase = "contacts";
  } else if (state.phase === "contacts") {
    const batch = state.customerReferences.slice(
      state.nextCustomerContactIndex,
      state.nextCustomerContactIndex + batchSize
    );
    const result =
      await resolveSalesCustomerContacts(batch);

    state.contacts = {
      ...state.contacts,
      ...result.contacts,
    };
    state.contactFailures.push(...result.failures);
    state.nextCustomerContactIndex += batch.length;

    if (
      state.nextCustomerContactIndex >=
      state.customerReferences.length
    ) {
      state.phase = "aggregate";
    }
  } else if (state.phase === "aggregate") {
    const index = buildIndex(state);
    await persistCompletedIndex(index);
    state.phase = "complete";
  }

  state.updatedAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);
  return {
    buildId: state.buildId,
    phase: state.phase,
    complete: state.phase === "complete",
    progress:
      state.phase === "opportunity_details"
        ? {
            processed:
              state.nextOpportunityDetailIndex,
            total: state.opportunities.length,
            unit: "opportunities",
          }
        : state.phase === "contacts"
          ? {
              processed:
                state.nextCustomerContactIndex,
              total:
                state.customerReferences.length,
              unit: "customers",
            }
          : null,
    verificationFailures:
      state.opportunityDetailFailures.length,
    contactFailures: state.contactFailures.length,
    nextAction: state.phase === "complete" ? "Sales Summary-indexet är klart." : "Vänta på nästa cron-körning eller kör uppdateringen igen.",
  };
}

export async function getSalesSummaryIndex(options: {
  customer?: string;
  responsible?: string;
  limit?: number;
} = {}) {
  const index = await readJson<SalesSummaryIndex>(INDEX_PATH);
  if (!index) throw new Error("Det finns ännu inget färdigt Sales Summary-index.");
  const customerQuery = options.customer?.trim().toLocaleLowerCase("sv");
  const responsibleQuery = options.responsible?.trim().toLocaleLowerCase("sv");
  const customers = index.customers
    .filter((item) => !customerQuery || item.customerName.toLocaleLowerCase("sv").includes(customerQuery) || item.customerId === options.customer)
    .filter((item) => !responsibleQuery || (item.responsible?.name ?? "").toLocaleLowerCase("sv").includes(responsibleQuery))
    .slice(0, Math.min(Math.max(options.limit ?? 100, 1), 500));
  return { ...index, returnedCustomers: customers.length, customers };
}

export async function getSalesSummaryIndexStatus() {
  const state = await readJson<BuildState>(STATE_PATH);
  const index = await readJson<SalesSummaryIndex>(INDEX_PATH);
  if (!state) return { exists: false, complete: false, phase: null, percentComplete: 0, latestCompletedIndexAt: index?.generatedAt ?? null };
  const phaseOrder: BuildPhase[] = [
    "projects",
    "invoices",
    "opportunities",
    "opportunity_details",
    "offers",
    "contacts",
    "aggregate",
    "complete",
  ];
  const phaseIndex = phaseOrder.indexOf(state.phase);
  const detailFraction = state.opportunities.length === 0 ? 0 : state.nextOpportunityDetailIndex / state.opportunities.length;
  const contactFraction =
    state.customerReferences.length === 0
      ? 0
      : state.nextCustomerContactIndex /
        state.customerReferences.length;
  const activePhaseFraction =
    state.phase === "opportunity_details"
      ? detailFraction
      : state.phase === "contacts"
        ? contactFraction
        : 0;
  const percentComplete =
    state.phase === "complete"
      ? 100
      : Math.round(
          ((phaseIndex + activePhaseFraction) /
            (phaseOrder.length - 1)) *
            1000
        ) / 10;
  return {
    exists: true,
    version: state.version,
    buildId: state.buildId,
    phase: state.phase,
    complete: state.phase === "complete",
    percentComplete,
    reportYear: state.reportYear,
    progress:
      state.phase === "opportunity_details"
        ? {
            processed:
              state.nextOpportunityDetailIndex,
            total: state.opportunities.length,
            remaining: Math.max(
              state.opportunities.length -
                state.nextOpportunityDetailIndex,
              0
            ),
            unit: "opportunities",
          }
        : state.phase === "contacts"
          ? {
              processed:
                state.nextCustomerContactIndex,
              total:
                state.customerReferences.length,
              remaining: Math.max(
                state.customerReferences.length -
                  state.nextCustomerContactIndex,
                0
              ),
              unit: "customers",
            }
          : null,
    sourceCounts: {
      projects: state.projects.length,
      invoices: state.invoices.length,
      opportunities: state.opportunities.length,
      offers: state.offers.length,
      customerContacts:
        Object.keys(state.contacts).length,
    },
    verificationFailures:
      state.opportunityDetailFailures.length,
    contactFailures: state.contactFailures.length,
    startedAt: state.startedAt,
    lastUpdatedAt: state.updatedAt,
    latestCompletedIndexAt: index?.generatedAt ?? null,
    servingPreviousCompletedIndex: index !== null && index.buildId !== state.buildId && state.phase !== "complete",
  };
}


