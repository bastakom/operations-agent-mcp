import {
  getContact,
  getOpportunity,
} from "./endpoints";
import { toSafeContact } from "./contacts";
import {
  getOpportunityPipeline,
  toSafeOpportunity,
} from "./opportunities";
import { getProjectCatalog } from "./resolvers";
import {
  getCustomerInvoiceSummary,
  getOfferPipeline,
  type SafeOffer,
} from "./sales";

type CustomerOpportunity = ReturnType<
  typeof toSafeOpportunity
>;

type AttentionLevel = "warning" | "info";

type DataQualityFlag = {
  code: string;
  level: AttentionLevel;
  message: string;
  entityType: "customer" | "project" | "opportunity" | "offer";
  entityId: string;
};

const ACTIVE_OFFER_STATES = new Set([
  "locked",
  "sentToCustomer",
  "openedByCustomer",
]);

const ACCEPTED_OFFER_STATES = new Set([
  "accepted",
  "acceptedSigned",
]);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function amount(
  value: number | null | undefined
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : 0;
}

function isActiveOffer(offer: SafeOffer): boolean {
  return ACTIVE_OFFER_STATES.has(offer.state);
}

function isAcceptedOffer(offer: SafeOffer): boolean {
  return ACCEPTED_OFFER_STATES.has(offer.state);
}

function ageInDays(
  value: string | null,
  today: Date
): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(
      (today.getTime() - parsed.getTime()) /
        (24 * 60 * 60 * 1000)
    )
  );
}

async function enrichCustomerOpportunities(
  opportunities: CustomerOpportunity[]
) {
  const enriched: CustomerOpportunity[] = [];
  const errors: Array<{
    opportunityId: string;
    message: string;
  }> = [];

  for (const opportunity of opportunities) {
    try {
      const detail = await getOpportunity(opportunity.id);
      enriched.push(toSafeOpportunity(detail));
    } catch (error) {
      enriched.push(opportunity);
      errors.push({
        opportunityId: opportunity.id,
        message:
          error instanceof Error
            ? error.message
            : "Unknown opportunity detail error",
      });
    }

    await wait(275);
  }

  return {
    opportunities: enriched,
    errors,
  };
}

function createDataQualityFlags(options: {
  customerId: string;
  responsibleId: string | null;
  projects: Awaited<ReturnType<typeof getProjectCatalog>>;
  opportunities: CustomerOpportunity[];
  offers: SafeOffer[];
  today: Date;
  staleOfferDays: number;
}): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];

  if (!options.responsibleId) {
    flags.push({
      code: "CUSTOMER_WITHOUT_RESPONSIBLE",
      level: "warning",
      message:
        "Customer has no responsible user registered in Blikk.",
      entityType: "customer",
      entityId: options.customerId,
    });
  }

  for (const project of options.projects) {
    if (
      project.isCompleted !== true &&
      !project.projectManagerId
    ) {
      flags.push({
        code: "ACTIVE_PROJECT_WITHOUT_MANAGER",
        level: "warning",
        message: `Active project "${project.title}" has no project manager.`,
        entityType: "project",
        entityId: project.id,
      });
    }
  }

  for (const opportunity of options.opportunities) {
    if (opportunity.state !== "open") {
      continue;
    }

    if (opportunity.turnover === null) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_VALUE",
        level: "warning",
        message: `Open opportunity "${opportunity.title}" has no value.`,
        entityType: "opportunity",
        entityId: opportunity.id,
      });
    }

    if (opportunity.probability === null) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_PROBABILITY",
        level: "warning",
        message: `Open opportunity "${opportunity.title}" has no probability.`,
        entityType: "opportunity",
        entityId: opportunity.id,
      });
    }

    if (!opportunity.estimatedClosingDate) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_DECISION_DATE",
        level: "warning",
        message: `Open opportunity "${opportunity.title}" has no estimated closing date.`,
        entityType: "opportunity",
        entityId: opportunity.id,
      });
    }

    if (!opportunity.responsible?.id) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_RESPONSIBLE",
        level: "warning",
        message: `Open opportunity "${opportunity.title}" has no responsible user.`,
        entityType: "opportunity",
        entityId: opportunity.id,
      });
    }
  }

  for (const offer of options.offers) {
    if (!offer.opportunity) {
      flags.push({
        code: "OFFER_WITHOUT_OPPORTUNITY",
        level: "info",
        message: `Offer ${offer.offerNumber} is not linked to an opportunity.`,
        entityType: "offer",
        entityId: offer.id,
      });
    }

    const daysOld = ageInDays(
      offer.updatedDate ?? offer.createdDate,
      options.today
    );

    if (
      isActiveOffer(offer) &&
      daysOld !== null &&
      daysOld > options.staleOfferDays
    ) {
      flags.push({
        code: "STALE_ACTIVE_OFFER",
        level: "warning",
        message: `Active offer ${offer.offerNumber} has not been updated for ${daysOld} days.`,
        entityType: "offer",
        entityId: offer.id,
      });
    }
  }

  return flags;
}

export async function getCustomerSalesSnapshot(options: {
  customerId: string;
  year?: number;
  staleOfferDays?: number;
}) {
  const customerId = options.customerId.trim();
  const year =
    options.year ?? new Date().getUTCFullYear();
  const staleOfferDays =
    options.staleOfferDays ?? 30;

  if (!/^\d+$/.test(customerId)) {
    throw new Error(
      "Customer ID must be a numeric Blikk contact ID."
    );
  }

  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  ) {
    throw new Error(
      "Year must be an integer between 2000 and 2100."
    );
  }

  if (
    !Number.isInteger(staleOfferDays) ||
    staleOfferDays < 1 ||
    staleOfferDays > 3650
  ) {
    throw new Error(
      "staleOfferDays must be an integer between 1 and 3650."
    );
  }

  // Keep source loads sequential to reduce pressure on Blikk's
  // four-requests-per-second rate limit.
  const rawCustomer = await getContact(customerId);
  const customer = toSafeContact(rawCustomer);

  const invoiceSummary =
    await getCustomerInvoiceSummary({
      customerId,
      year,
    });

  const allProjects = await getProjectCatalog();
  const projects = allProjects.filter(
    (project) => project.customerId === customerId
  );

  const opportunityPipeline =
    await getOpportunityPipeline({});
  const customerOpportunityList =
    opportunityPipeline.opportunities.filter(
      (opportunity) =>
        opportunity.customer?.id === customerId
    );

  const enriched =
    await enrichCustomerOpportunities(
      customerOpportunityList
    );

  const offerPipeline = await getOfferPipeline({});
  const offers = offerPipeline.offers.filter(
    (offer) => offer.customer?.id === customerId
  );

  const activeProjects = projects.filter(
    (project) => project.isCompleted !== true
  );
  const openOpportunities =
    enriched.opportunities.filter(
      (opportunity) =>
        opportunity.state === "open"
    );
  const activeOffers = offers.filter(isActiveOffer);
  const acceptedOffers =
    offers.filter(isAcceptedOffer);

  const pipeline = openOpportunities.reduce(
    (sum, opportunity) =>
      sum + amount(opportunity.turnover),
    0
  );

  const opportunitiesWithProbability =
    openOpportunities.filter(
      (opportunity) =>
        opportunity.probability !== null
    );

  const weightedPipeline =
    opportunitiesWithProbability.reduce(
      (sum, opportunity) => {
        const probability = Math.min(
          100,
          Math.max(
            0,
            amount(opportunity.probability)
          )
        );

        return (
          sum +
          amount(opportunity.turnover) *
            (probability / 100)
        );
      },
      0
    );

  const pipelineWithoutProbability =
    openOpportunities
      .filter(
        (opportunity) =>
          opportunity.probability === null
      )
      .reduce(
        (sum, opportunity) =>
          sum + amount(opportunity.turnover),
        0
      );

  const responsible =
    customer.responsible ??
    openOpportunities.find(
      (opportunity) =>
        opportunity.responsible !== null
    )?.responsible ??
    (activeProjects.find(
      (project) =>
        project.projectManagerId !== null
    )
      ? {
          id:
            activeProjects.find(
              (project) =>
                project.projectManagerId !== null
            )?.projectManagerId ?? null,
          name:
            activeProjects.find(
              (project) =>
                project.projectManagerId !== null
            )?.projectManagerName ?? null,
        }
      : null);

  const today = new Date();
  const dataQualityFlags =
    createDataQualityFlags({
      customerId,
      responsibleId: responsible?.id ?? null,
      projects,
      opportunities:
        enriched.opportunities,
      offers,
      today,
      staleOfferDays,
    });

  const acceptedOfferValue =
    acceptedOffers.reduce(
      (sum, offer) =>
        sum + offer.offerValue,
      0
    );

  const activeOfferValue = activeOffers.reduce(
    (sum, offer) =>
      sum + offer.offerValue,
    0
  );

  return {
    generatedAt: today.toISOString(),
    snapshotVersion:
      "customer-sales-snapshot-v1",
    currency: "SEK",
    customer: {
      id: customer.id,
      name: customer.name,
      customerNumber:
        customer.customerNumber,
      responsible,
      email: customer.email,
      phone:
        customer.phoneNumber ??
        customer.cellPhoneNumber,
    },
    period: {
      year,
    },
    financials: {
      invoicedExcludingVat:
        invoiceSummary.totals
          .amountExcludingVat,
      invoiceCount:
        invoiceSummary.totals.invoices,
      pipeline,
      weightedPipeline,
      pipelineWithoutProbability,
      probabilityCoverage: {
        withProbability:
          opportunitiesWithProbability.length,
        totalOpen:
          openOpportunities.length,
      },
      activeOfferValue,
      acceptedOfferValue,
      provisionalForecastExcludingSold:
        invoiceSummary.totals
          .amountExcludingVat +
        weightedPipeline,
      soldNotInvoiced: null,
      annualBudget: null,
      budgetGap: null,
    },
    counts: {
      projects: projects.length,
      activeProjects:
        activeProjects.length,
      opportunities:
        enriched.opportunities.length,
      openOpportunities:
        openOpportunities.length,
      offers: offers.length,
      activeOffers: activeOffers.length,
      acceptedOffers:
        acceptedOffers.length,
      dataQualityFlags:
        dataQualityFlags.length,
    },
    activeProjects,
    openOpportunities,
    activeOffers,
    acceptedOffers,
    invoices: invoiceSummary.invoices,
    dataQuality: {
      flags: dataQualityFlags,
      opportunityDetailErrors:
        enriched.errors,
    },
    calculationNotes: [
      "Invoice amounts are excluding VAT.",
      "Only open opportunities are included in pipeline.",
      "Weighted pipeline uses Blikk opportunity probability when available.",
      "Accepted offer value is kept separate and is not automatically treated as sold-not-invoiced.",
      "The provisional forecast excludes sold-not-invoiced and annual budget because those definitions are not yet available.",
    ],
  };
}

