import {
  getAllCustomerInvoices,
  getAllOffers,
  type OfferParams,
  type OfferState,
} from "./endpoints";

type NameId = {
  id: string | null;
  name: string | null;
};

export type SafeCustomerInvoice = {
  id: string;
  invoiceDate: string | null;
  createdDate: string | null;
  fromDate: string | null;
  toDate: string | null;
  amountExcludingVat: number;
  customer: NameId | null;
  sentToEconomySystemAt: string | null;
};

export type SafeOffer = {
  id: string;
  offerNumber: string;
  version: number;
  title: string;
  offerValue: number;
  state: OfferState | "unknown";
  hasPdf: boolean;
  responsible: NameId | null;
  customer: NameId | null;
  opportunity: NameId | null;
  createdDate: string | null;
  updatedDate: string | null;
};

type CustomerInvoiceSummaryOptions = {
  customerId?: string;
  year?: number;
};

type OfferPipelineOptions = Omit<
  OfferParams,
  "page" | "pageSize"
>;

const ACCEPTED_OFFER_STATES = new Set<OfferState>([
  "accepted",
  "acceptedSigned",
]);

const ACTIVE_OFFER_STATES = new Set<OfferState>([
  "locked",
  "sentToCustomer",
  "openedByCustomer",
]);

function record(
  value: unknown
): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const result = String(value).trim();
  return result || null;
}

function numberValue(
  value: unknown,
  fallback = 0
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(
      value.trim().replace(",", ".")
    );

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function nameId(value: unknown): NameId | null {
  const item = record(value);

  if (!item) {
    return null;
  }

  const id = text(item.id);
  const name = text(item.name ?? item.title);

  return id || name ? { id, name } : null;
}

function normalizeOfferState(
  value: unknown
): OfferState | "unknown" {
  const normalized = text(value)
    ?.replace(/[\s_-]/g, "")
    .toLowerCase();

  switch (normalized) {
    case "draft":
      return "draft";
    case "locked":
      return "locked";
    case "senttocustomer":
      return "sentToCustomer";
    case "openedbycustomer":
      return "openedByCustomer";
    case "accepted":
      return "accepted";
    case "acceptedsigned":
      return "acceptedSigned";
    case "denied":
      return "denied";
    default:
      return "unknown";
  }
}

export function toSafeCustomerInvoice(
  item: Record<string, unknown>
): SafeCustomerInvoice {
  const id = text(item.id);

  if (!id) {
    throw new Error(
      "Blikk returned a customer invoice without an id."
    );
  }

  return {
    id,
    invoiceDate: text(item.invoiceDate),
    createdDate: text(item.createdDate),
    fromDate: text(item.fromDate),
    toDate: text(item.toDate),
    amountExcludingVat: numberValue(item.sum),
    customer: nameId(item.customer),
    sentToEconomySystemAt: text(
      item.sentToEconomySystem
    ),
  };
}

export function toSafeOffer(
  item: Record<string, unknown>
): SafeOffer {
  const id = text(item.id);
  const offerNumber = text(item.offerNumber);

  if (!id || !offerNumber) {
    throw new Error(
      "Blikk returned an offer without an id or offer number."
    );
  }

  return {
    id,
    offerNumber,
    version: Math.max(
      0,
      Math.floor(numberValue(item.version))
    ),
    title: text(item.title) ?? "Untitled offer",
    offerValue: numberValue(item.offerValue),
    state: normalizeOfferState(item.offerState),
    hasPdf: item.hasPdf === true,
    responsible: nameId(item.user),
    customer: nameId(item.customer),
    opportunity: nameId(item.opportunity),
    createdDate: text(item.createdDate),
    updatedDate: text(item.updatedDate),
  };
}

function dateYear(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-/);

  return match ? Number(match[1]) : null;
}

function sumBy(
  items: SafeOffer[],
  predicate: (item: SafeOffer) => boolean
): number {
  return items
    .filter(predicate)
    .reduce(
      (sum, item) => sum + item.offerValue,
      0
    );
}

function latestOfferVersions(
  offers: SafeOffer[]
): SafeOffer[] {
  const latest = new Map<string, SafeOffer>();

  for (const offer of offers) {
    const current = latest.get(offer.offerNumber);

    if (
      !current ||
      offer.version > current.version ||
      (offer.version === current.version &&
        (offer.updatedDate ?? "") >
          (current.updatedDate ?? ""))
    ) {
      latest.set(offer.offerNumber, offer);
    }
  }

  return [...latest.values()].sort((a, b) =>
    (b.updatedDate ?? b.createdDate ?? "").localeCompare(
      a.updatedDate ?? a.createdDate ?? ""
    )
  );
}

function groupOffersByState(
  offers: SafeOffer[]
) {
  const groups = new Map<
    string,
    { count: number; value: number }
  >();

  for (const offer of offers) {
    const current = groups.get(offer.state) ?? {
      count: 0,
      value: 0,
    };

    current.count += 1;
    current.value += offer.offerValue;
    groups.set(offer.state, current);
  }

  return [...groups.entries()]
    .map(([state, values]) => ({
      state,
      ...values,
    }))
    .sort((a, b) => b.value - a.value);
}

export async function getCustomerInvoiceSummary(
  options: CustomerInvoiceSummaryOptions = {}
) {
  if (
    options.year !== undefined &&
    (!Number.isInteger(options.year) ||
      options.year < 2000 ||
      options.year > 2100)
  ) {
    throw new Error(
      "Invoice year must be an integer between 2000 and 2100."
    );
  }

  const response = await getAllCustomerInvoices({
    customerId: options.customerId,
    sortBy: "invoiceDate",
    sortOrder: "descending",
  });

  const allInvoices = response.items.map(
    toSafeCustomerInvoice
  );

  const invoices =
    options.year === undefined
      ? allInvoices
      : allInvoices.filter(
          (invoice) =>
            dateYear(invoice.invoiceDate) ===
            options.year
        );

  const amountExcludingVat = invoices.reduce(
    (sum, invoice) =>
      sum + invoice.amountExcludingVat,
    0
  );

  const sentToEconomySystem = invoices.filter(
    (invoice) =>
      invoice.sentToEconomySystemAt !== null
  );

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      customerId: options.customerId ?? null,
      year: options.year ?? null,
    },
    currency: "SEK",
    amountBasis: "excluding VAT",
    totals: {
      invoices: invoices.length,
      amountExcludingVat,
      sentToEconomySystem:
        sentToEconomySystem.length,
      sentAmountExcludingVat:
        sentToEconomySystem.reduce(
          (sum, invoice) =>
            sum + invoice.amountExcludingVat,
          0
        ),
      notSentToEconomySystem:
        invoices.length -
        sentToEconomySystem.length,
    },
    invoices,
  };
}

export async function getOfferPipeline(
  options: OfferPipelineOptions = {}
) {
  const response = await getAllOffers({
    ...options,
    sortBy: options.sortBy ?? "updatedDate",
    sortOrder: options.sortOrder ?? "descending",
  });

  const allVersions = response.items.map(toSafeOffer);
  const offers = latestOfferVersions(allVersions);

  return {
    generatedAt: new Date().toISOString(),
    filters: options,
    currency: "SEK",
    versionPolicy:
      "Only the latest version of each offer number is included in totals.",
    totals: {
      fetchedVersions: allVersions.length,
      uniqueOffers: offers.length,
      totalLatestOfferValue: offers.reduce(
        (sum, offer) => sum + offer.offerValue,
        0
      ),
      activeOffers: offers.filter(
        (offer) =>
          offer.state !== "unknown" &&
          ACTIVE_OFFER_STATES.has(offer.state)
      ).length,
      activeOfferValue: sumBy(
        offers,
        (offer) =>
          offer.state !== "unknown" &&
          ACTIVE_OFFER_STATES.has(offer.state)
      ),
      acceptedOffers: offers.filter(
        (offer) =>
          offer.state !== "unknown" &&
          ACCEPTED_OFFER_STATES.has(offer.state)
      ).length,
      acceptedOfferValue: sumBy(
        offers,
        (offer) =>
          offer.state !== "unknown" &&
          ACCEPTED_OFFER_STATES.has(offer.state)
      ),
      deniedOfferValue: sumBy(
        offers,
        (offer) => offer.state === "denied"
      ),
      draftOfferValue: sumBy(
        offers,
        (offer) => offer.state === "draft"
      ),
      withoutOpportunity: offers.filter(
        (offer) => offer.opportunity === null
      ).length,
      withoutCustomer: offers.filter(
        (offer) => offer.customer === null
      ).length,
    },
    byState: groupOffersByState(offers),
    offers,
  };
}

