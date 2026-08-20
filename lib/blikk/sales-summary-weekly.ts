import { get, list } from "@vercel/blob";
import type {
  SalesSummaryCustomer,
  SalesSummaryIndex,
} from "./sales-summary-index";

const SNAPSHOT_PREFIX = "sales-summary/weekly/";

type Opportunity = SalesSummaryIndex["opportunityLedger"][number];
type Offer = SalesSummaryIndex["offerLedger"][number];

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private" });

  if (!result || result.statusCode !== 200) {
    return null;
  }

  return JSON.parse(
    await new Response(result.stream).text()
  ) as T;
}

function opportunityLedger(index: SalesSummaryIndex): Opportunity[] {
  return Array.isArray(index.opportunityLedger)
    ? index.opportunityLedger
    : [];
}

function offerLedger(index: SalesSummaryIndex): Offer[] {
  return Array.isArray(index.offerLedger)
    ? index.offerLedger
    : [];
}

function customerMap(index: SalesSummaryIndex) {
  return new Map(
    index.customers.map((customer) => [
      customer.customerId,
      customer,
    ])
  );
}

function opportunityMap(index: SalesSummaryIndex) {
  return new Map(
    opportunityLedger(index).map((opportunity) => [
      opportunity.id,
      opportunity,
    ])
  );
}

function offerKey(offer: Offer) {
  return offer.offerNumber !== null
    ? `number:${offer.offerNumber}`
    : `id:${offer.id}`;
}

function offerMap(index: SalesSummaryIndex) {
  return new Map(
    offerLedger(index).map((offer) => [
      offerKey(offer),
      offer,
    ])
  );
}

function isActiveOffer(offer: Offer) {
  return [
    "locked",
    "sentToCustomer",
    "openedByCustomer",
  ].includes(offer.state);
}

function isAcceptedOffer(offer: Offer) {
  return ["accepted", "acceptedSigned"].includes(
    offer.state
  );
}

function customerChange(
  customerId: string,
  previous: SalesSummaryCustomer | null,
  current: SalesSummaryCustomer | null
) {
  return {
    customerId,
    customerName:
      current?.customerName ??
      previous?.customerName ??
      customerId,
    responsible:
      current?.responsible ??
      previous?.responsible ??
      null,
    isNewCustomer: previous === null,
    isRemovedCustomer: current === null,
    invoicedChange:
      (current?.invoicedCurrentYear ?? 0) -
      (previous?.invoicedCurrentYear ?? 0),
    pipelineChange:
      (current?.pipeline ?? 0) -
      (previous?.pipeline ?? 0),
    weightedPipelineChange:
      (current?.weightedPipeline ?? 0) -
      (previous?.weightedPipeline ?? 0),
    forecastChange:
      (current?.preliminaryForecast ?? 0) -
      (previous?.preliminaryForecast ?? 0),
    activeProjectChange:
      (current?.activeProjects.length ?? 0) -
      (previous?.activeProjects.length ?? 0),
    openOpportunityChange:
      (current?.openOpportunities.length ?? 0) -
      (previous?.openOpportunities.length ?? 0),
    activeOfferChange:
      (current?.activeOffers.length ?? 0) -
      (previous?.activeOffers.length ?? 0),
    acceptedOfferChange:
      (current?.acceptedOffers.length ?? 0) -
      (previous?.acceptedOffers.length ?? 0),
    bookedSalesMeetingChange:
      (current?.bookedSalesMeetings ?? 0) -
      (previous?.bookedSalesMeetings ?? 0),
  };
}

function opportunityTransitions(
  previous: SalesSummaryIndex,
  current: SalesSummaryIndex
) {
  const previousItems = opportunityMap(previous);
  const currentItems = opportunityMap(current);
  const newOpportunities: Opportunity[] = [];
  const newlyOpen: Opportunity[] = [];
  const newlyWon: Opportunity[] = [];
  const newlyLost: Opportunity[] = [];
  const reopened: Opportunity[] = [];
  const changedValueOrProbability: Array<{
    id: string;
    title: string;
    customer: Opportunity["customer"];
    previousTurnover: number | null;
    currentTurnover: number | null;
    previousProbability: number | null;
    currentProbability: number | null;
  }> = [];

  for (const opportunity of currentItems.values()) {
    const old = previousItems.get(opportunity.id);

    if (!old) {
      newOpportunities.push(opportunity);
      if (opportunity.state === "open") {
        newlyOpen.push(opportunity);
      }
      continue;
    }

    if (old.state !== opportunity.state) {
      if (opportunity.state === "won") {
        newlyWon.push(opportunity);
      } else if (opportunity.state === "lost") {
        newlyLost.push(opportunity);
      } else if (
        opportunity.state === "open" &&
        old.state !== "open"
      ) {
        reopened.push(opportunity);
      }
    }

    if (
      old.turnover !== opportunity.turnover ||
      old.probability !== opportunity.probability
    ) {
      changedValueOrProbability.push({
        id: opportunity.id,
        title: opportunity.title,
        customer: opportunity.customer,
        previousTurnover: old.turnover,
        currentTurnover: opportunity.turnover,
        previousProbability: old.probability,
        currentProbability: opportunity.probability,
      });
    }
  }

  return {
    newOpportunities,
    newlyOpen,
    newlyWon,
    newlyLost,
    reopened,
    changedValueOrProbability,
  };
}

function offerTransitions(
  previous: SalesSummaryIndex,
  current: SalesSummaryIndex
) {
  const previousItems = offerMap(previous);
  const currentItems = offerMap(current);
  const newOffers: Offer[] = [];
  const newlyActive: Offer[] = [];
  const newlyAccepted: Offer[] = [];
  const newlyDenied: Offer[] = [];
  const changedValue: Array<{
    id: string;
    offerNumber: string | null;
    title: string;
    customer: Offer["customer"];
    previousValue: number;
    currentValue: number;
  }> = [];

  for (const [key, offer] of currentItems) {
    const old = previousItems.get(key);

    if (!old) {
      newOffers.push(offer);
      if (isActiveOffer(offer)) {
        newlyActive.push(offer);
      }
      if (isAcceptedOffer(offer)) {
        newlyAccepted.push(offer);
      }
      if (offer.state === "denied") {
        newlyDenied.push(offer);
      }
      continue;
    }

    if (old.state !== offer.state) {
      if (isActiveOffer(offer)) {
        newlyActive.push(offer);
      }
      if (isAcceptedOffer(offer)) {
        newlyAccepted.push(offer);
      }
      if (offer.state === "denied") {
        newlyDenied.push(offer);
      }
    }

    if (old.offerValue !== offer.offerValue) {
      changedValue.push({
        id: offer.id,
        offerNumber: offer.offerNumber,
        title: offer.title,
        customer: offer.customer,
        previousValue: old.offerValue,
        currentValue: offer.offerValue,
      });
    }
  }

  return {
    newOffers,
    newlyActive,
    newlyAccepted,
    newlyDenied,
    changedValue,
  };
}

async function listSnapshots() {
  const result = await list({
    prefix: SNAPSHOT_PREFIX,
    limit: 1000,
  });

  return result.blobs
    .map((blob) => blob.pathname)
    .filter((pathname) =>
      /^sales-summary\/weekly\/\d{4}-W\d{2}\.json$/.test(
        pathname
      )
    )
    .sort();
}

export async function getSalesSummaryWeeklyComparison(
  options: { week?: string; customerLimit?: number } = {}
) {
  const snapshots = await listSnapshots();

  if (snapshots.length < 2) {
    return {
      available: false,
      snapshotCount: snapshots.length,
      availableWeeks: snapshots.map((pathname) =>
        pathname.split("/").at(-1)?.replace(".json", "")
      ),
      message:
        "Veckojämförelse kräver snapshots från minst två olika ISO-veckor.",
    };
  }

  const requestedPath = options.week
    ? `${SNAPSHOT_PREFIX}${options.week}.json`
    : snapshots.at(-1) as string;
  const currentIndex = snapshots.indexOf(requestedPath);

  if (currentIndex < 1) {
    throw new Error(
      options.week
        ? `Det finns ingen föregående snapshot för ${options.week}.`
        : "Det finns ingen föregående veckosnapshot."
    );
  }

  const previousPath = snapshots[currentIndex - 1];
  const [previous, current] = await Promise.all([
    readJson<SalesSummaryIndex>(previousPath),
    readJson<SalesSummaryIndex>(requestedPath),
  ]);

  if (!previous || !current) {
    throw new Error(
      "En eller flera veckosnapshots kunde inte läsas."
    );
  }

  const previousCustomers = customerMap(previous);
  const currentCustomers = customerMap(current);
  const customerIds = new Set([
    ...previousCustomers.keys(),
    ...currentCustomers.keys(),
  ]);
  const allCustomerChanges = [...customerIds]
    .map((customerId) =>
      customerChange(
        customerId,
        previousCustomers.get(customerId) ?? null,
        currentCustomers.get(customerId) ?? null
      )
    )
    .filter(
      (item) =>
        item.isNewCustomer ||
        item.isRemovedCustomer ||
        item.invoicedChange !== 0 ||
        item.pipelineChange !== 0 ||
        item.weightedPipelineChange !== 0 ||
        item.forecastChange !== 0 ||
        item.activeProjectChange !== 0 ||
        item.openOpportunityChange !== 0 ||
        item.activeOfferChange !== 0 ||
        item.acceptedOfferChange !== 0 ||
        item.bookedSalesMeetingChange !== 0
    )
    .sort(
      (a, b) =>
        Math.abs(b.forecastChange) -
          Math.abs(a.forecastChange) ||
        Math.abs(b.invoicedChange) -
          Math.abs(a.invoicedChange)
    );

  const opportunityChanges = opportunityTransitions(
    previous,
    current
  );
  const offerChanges = offerTransitions(previous, current);
  const customerLimit = Math.min(
    Math.max(options.customerLimit ?? 50, 1),
    500
  );

  return {
    available: true,
    currency: "SEK",
    previous: {
      pathname: previousPath,
      generatedAt: previous.generatedAt,
      buildId: previous.buildId,
    },
    current: {
      pathname: requestedPath,
      generatedAt: current.generatedAt,
      buildId: current.buildId,
    },
    agencyChanges: {
      invoiced:
        current.totals.invoiced -
        previous.totals.invoiced,
      pipeline:
        current.totals.pipeline -
        previous.totals.pipeline,
      weightedPipeline:
        current.totals.weightedPipeline -
        previous.totals.weightedPipeline,
      preliminaryForecast:
        current.totals.preliminaryForecast -
        previous.totals.preliminaryForecast,
      activeProjects:
        current.totals.activeProjects -
        previous.totals.activeProjects,
      activeOpportunities:
        current.totals.activeOpportunities -
        previous.totals.activeOpportunities,
      activeOffers:
        current.totals.activeOffers -
        previous.totals.activeOffers,
      acceptedOffers:
        current.totals.acceptedOffers -
        previous.totals.acceptedOffers,
      bookedSalesMeetings:
        current.totals.bookedSalesMeetings -
        previous.totals.bookedSalesMeetings,
    },
    opportunityChanges,
    offerChanges,
    changedCustomers: allCustomerChanges.slice(
      0,
      customerLimit
    ),
    changedCustomerCount: allCustomerChanges.length,
    salesAttention: {
      largestNegativeForecastChanges:
        allCustomerChanges
          .filter((item) => item.forecastChange < 0)
          .sort(
            (a, b) =>
              a.forecastChange - b.forecastChange
          )
          .slice(0, 10),
      largestPositiveForecastChanges:
        allCustomerChanges
          .filter((item) => item.forecastChange > 0)
          .sort(
            (a, b) =>
              b.forecastChange - a.forecastChange
          )
          .slice(0, 10),
      newlyLostOpportunities:
        opportunityChanges.newlyLost.slice(0, 20),
      newlyWonOpportunities:
        opportunityChanges.newlyWon.slice(0, 20),
      newlyDeniedOffers:
        offerChanges.newlyDenied.slice(0, 20),
    },
    limitations: [
      "Sålt men ej fakturerat, årsbudget och budgetgap jämförs inte så länge deras auktoritativa källor saknas i MCP-indexet.",
      "Bokade säljmöten baseras på Blikks affärsstatus och är inte en kalenderjämförelse.",
    ],
  };
}
