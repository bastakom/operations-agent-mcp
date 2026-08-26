import type { ProjectCatalogItem } from "./resolvers";
import type { SafeOffer } from "./sales";
import type { toSafeOpportunity } from "./opportunities";
import type { SalesSummaryCustomer } from "./sales-summary-index";

type SafeOpportunity = ReturnType<typeof toSafeOpportunity>;

export type SalesDataQualityFlag = {
  code:
    | "DUPLICATE_CUSTOMER_NAME"
    | "CUSTOMER_WITHOUT_RESPONSIBLE"
    | "PROJECT_WITHOUT_CUSTOMER"
    | "OPEN_OPPORTUNITY_WITHOUT_CUSTOMER"
    | "OPEN_OPPORTUNITY_WITHOUT_VALUE"
    | "OPEN_OPPORTUNITY_WITHOUT_PROBABILITY"
    | "OPEN_OPPORTUNITY_WITH_INVALID_PROBABILITY"
    | "OPEN_OPPORTUNITY_WITHOUT_CLOSING_DATE"
    | "ACTIVE_OFFER_WITHOUT_CUSTOMER"
    | "ACTIVE_OFFER_WITHOUT_VALUE"
    | "ACTIVE_OFFER_WITHOUT_RESPONSIBLE"
    | "ACCEPTED_OFFER_WITHOUT_OPPORTUNITY";
  severity: "warning" | "error";
  entityType: "customer" | "project" | "opportunity" | "offer";
  entityId: string;
  customerId: string | null;
  customerName: string | null;
  message: string;
  sourceFacts: Record<string, unknown>;
};

export type SalesDataQualityResult = {
  generatedAt: string;
  totalFlags: number;
  errorCount: number;
  warningCount: number;
  countsByCode: Record<string, number>;
  flags: SalesDataQualityFlag[];
  limitations: string[];
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

function normalizeCustomerName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv")
    .replace(/\b(ab|aktiebolag)\b/g, "")
    .replace(/[^a-z0-9åäö]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function customerDetails(
  customersById: Map<string, SalesSummaryCustomer>,
  customerId: string | null
) {
  const customer = customerId
    ? customersById.get(customerId) ?? null
    : null;

  return {
    customerId,
    customerName: customer?.customerName ?? null,
  };
}

function sortFlags(flags: SalesDataQualityFlag[]) {
  return flags.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "error" ? -1 : 1;
    }

    const code = left.code.localeCompare(right.code, "sv");
    if (code !== 0) return code;

    return (left.customerName ?? left.entityId).localeCompare(
      right.customerName ?? right.entityId,
      "sv"
    );
  });
}

export function buildSalesDataQuality(
  input: {
    customers: SalesSummaryCustomer[];
    projects: ProjectCatalogItem[];
    opportunities: SafeOpportunity[];
    offers: SafeOffer[];
    generatedAt?: string;
  }
): SalesDataQualityResult {
  const generatedAt =
    input.generatedAt ?? new Date().toISOString();
  const flags: SalesDataQualityFlag[] = [];
  const customersById = new Map(
    input.customers.map((customer) => [
      customer.customerId,
      customer,
    ])
  );

  const names = new Map<string, SalesSummaryCustomer[]>();
  for (const customer of input.customers) {
    const normalized = normalizeCustomerName(
      customer.customerName
    );
    if (!normalized) continue;
    names.set(normalized, [
      ...(names.get(normalized) ?? []),
      customer,
    ]);
  }

  for (const matchingCustomers of names.values()) {
    const uniqueIds = [
      ...new Set(
        matchingCustomers.map((customer) =>
          customer.customerId
        )
      ),
    ];
    if (uniqueIds.length < 2) continue;

    for (const customer of matchingCustomers) {
      flags.push({
        code: "DUPLICATE_CUSTOMER_NAME",
        severity: "warning",
        entityType: "customer",
        entityId: customer.customerId,
        customerId: customer.customerId,
        customerName: customer.customerName,
        message: `${customer.customerName} förekommer med flera Blikk kund-ID:n.`,
        sourceFacts: {
          matchingCustomerIds: uniqueIds,
          matchingCustomerNames: matchingCustomers.map(
            (item) => item.customerName
          ),
        },
      });
    }
  }

  for (const customer of input.customers) {
    if (customer.responsible?.name) continue;

    flags.push({
      code: "CUSTOMER_WITHOUT_RESPONSIBLE",
      severity: "warning",
      entityType: "customer",
      entityId: customer.customerId,
      customerId: customer.customerId,
      customerName: customer.customerName,
      message: `${customer.customerName} saknar verifierad ansvarig.`,
      sourceFacts: {
        responsibleSource: customer.responsibleSource,
      },
    });
  }

  for (const project of input.projects) {
    if (project.customerId) continue;

    flags.push({
      code: "PROJECT_WITHOUT_CUSTOMER",
      severity: "error",
      entityType: "project",
      entityId: project.id,
      customerId: null,
      customerName: null,
      message: `Projektet ${project.title} saknar kundkoppling.`,
      sourceFacts: {
        projectTitle: project.title,
        orderNumber: project.orderNumber,
      },
    });
  }

  for (const opportunity of input.opportunities) {
    if (opportunity.state !== "open") continue;

    const details = customerDetails(
      customersById,
      opportunity.customer?.id ?? null
    );

    if (!opportunity.customer?.id) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_CUSTOMER",
        severity: "error",
        entityType: "opportunity",
        entityId: opportunity.id,
        ...details,
        message: `Den öppna affären ${opportunity.title} saknar kundkoppling.`,
        sourceFacts: { opportunityTitle: opportunity.title },
      });
    }

    if (
      opportunity.turnover === null ||
      opportunity.turnover <= 0
    ) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_VALUE",
        severity: "warning",
        entityType: "opportunity",
        entityId: opportunity.id,
        ...details,
        message: `Den öppna affären ${opportunity.title} saknar ett positivt affärsvärde.`,
        sourceFacts: { turnover: opportunity.turnover },
      });
    }

    if (opportunity.probability === null) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_PROBABILITY",
        severity: "warning",
        entityType: "opportunity",
        entityId: opportunity.id,
        ...details,
        message: `Den öppna affären ${opportunity.title} saknar sannolikhet.`,
        sourceFacts: { probability: null },
      });
    } else if (
      opportunity.probability < 0 ||
      opportunity.probability > 100
    ) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITH_INVALID_PROBABILITY",
        severity: "error",
        entityType: "opportunity",
        entityId: opportunity.id,
        ...details,
        message: `Den öppna affären ${opportunity.title} har en sannolikhet utanför 0–100 procent.`,
        sourceFacts: {
          probability: opportunity.probability,
        },
      });
    }

    if (!opportunity.estimatedClosingDate) {
      flags.push({
        code: "OPEN_OPPORTUNITY_WITHOUT_CLOSING_DATE",
        severity: "warning",
        entityType: "opportunity",
        entityId: opportunity.id,
        ...details,
        message: `Den öppna affären ${opportunity.title} saknar förväntat beslutsdatum.`,
        sourceFacts: { estimatedClosingDate: null },
      });
    }
  }

  for (const offer of input.offers) {
    const isActive = ACTIVE_OFFER_STATES.has(offer.state);
    const isAccepted = ACCEPTED_OFFER_STATES.has(offer.state);
    if (!isActive && !isAccepted) continue;

    const details = customerDetails(
      customersById,
      offer.customer?.id ?? null
    );

    if (isActive && !offer.customer?.id) {
      flags.push({
        code: "ACTIVE_OFFER_WITHOUT_CUSTOMER",
        severity: "error",
        entityType: "offer",
        entityId: offer.id,
        ...details,
        message: `Den aktiva offerten ${offer.offerNumber} saknar kundkoppling.`,
        sourceFacts: {
          offerNumber: offer.offerNumber,
          state: offer.state,
        },
      });
    }

    if (isActive && offer.offerValue <= 0) {
      flags.push({
        code: "ACTIVE_OFFER_WITHOUT_VALUE",
        severity: "warning",
        entityType: "offer",
        entityId: offer.id,
        ...details,
        message: `Den aktiva offerten ${offer.offerNumber} saknar ett positivt värde.`,
        sourceFacts: {
          offerNumber: offer.offerNumber,
          offerValue: offer.offerValue,
          state: offer.state,
        },
      });
    }

    if (isActive && !offer.responsible?.name) {
      flags.push({
        code: "ACTIVE_OFFER_WITHOUT_RESPONSIBLE",
        severity: "warning",
        entityType: "offer",
        entityId: offer.id,
        ...details,
        message: `Den aktiva offerten ${offer.offerNumber} saknar ansvarig.`,
        sourceFacts: {
          offerNumber: offer.offerNumber,
          state: offer.state,
        },
      });
    }

    if (isAccepted && !offer.opportunity?.id) {
      flags.push({
        code: "ACCEPTED_OFFER_WITHOUT_OPPORTUNITY",
        severity: "warning",
        entityType: "offer",
        entityId: offer.id,
        ...details,
        message: `Den accepterade offerten ${offer.offerNumber} saknar kopplad affärsmöjlighet.`,
        sourceFacts: {
          offerNumber: offer.offerNumber,
          offerValue: offer.offerValue,
          state: offer.state,
        },
      });
    }
  }

  sortFlags(flags);

  const countsByCode: Record<string, number> = {};
  for (const flag of flags) {
    countsByCode[flag.code] =
      (countsByCode[flag.code] ?? 0) + 1;
  }

  return {
    generatedAt,
    totalFlags: flags.length,
    errorCount: flags.filter(
      (flag) => flag.severity === "error"
    ).length,
    warningCount: flags.filter(
      (flag) => flag.severity === "warning"
    ).length,
    countsByCode,
    flags,
    limitations: [
      "Saknad årsbudget kontrolleras inte innan en verifierad budgetkälla har kopplats in.",
      "Nästa aktivitet och bokade möten kan inte kvalitetskontrolleras som kalenderdata med nuvarande Blikk-underlag.",
      "Dublettkontrollen är en varningssignal baserad på normaliserat kundnamn; Blikk kund-ID är fortsatt primär identitet.",
      "Accepterade offerter klassas inte automatiskt som sålt men ej fakturerat.",
    ],
  };
}
