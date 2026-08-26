import {
  getAllPaymentPlans,
  type BlikkRawItem,
} from "./endpoints";
import { resolveProject } from "./resolvers";

type NameId = {
  id: string | null;
  name: string | null;
};

export type SafePaymentPlan = {
  id: string;
  articleNumber: string | null;
  description: string | null;
  price: number;
  units: number;
  amount: number;
  batchId: string | null;
  plannedInvoiceDate: string | null;
  invoiceId: string | null;
  invoicedDate: string | null;
  invoiceDraftId: string | null;
  project: NameId | null;
  createdDate: string | null;
  updatedDate: string | null;
  classification:
    | "invoiced"
    | "in_invoice_draft"
    | "not_invoiced_without_draft";
};

export type UninvoicedPaymentPlanDiagnostic = {
  diagnosticVersion: "uninvoiced-payment-plans-v1";
  generatedAt: string;
  requestedProject: string;
  projectId: string;
  projectName: string;
  currency: "SEK";
  filters: {
    plannedFrom: string | null;
    plannedTo: string | null;
  };
  totals: {
    paymentPlans: number;
    amount: number;
    invoicedPlans: number;
    invoicedAmount: number;
    uninvoicedPlans: number;
    uninvoicedAmount: number;
    plansInInvoiceDraft: number;
    amountInInvoiceDraft: number;
    plansWithoutInvoiceDraft: number;
    amountWithoutInvoiceDraft: number;
  };
  byPlannedYear: Array<{
    year: string;
    plans: number;
    amount: number;
  }>;
  paymentPlans: SafePaymentPlan[];
  interpretation: {
    candidateSoldNotInvoicedAmount: number;
    acceptedAsAuthoritativeSoldNotInvoiced: false;
    reason: string;
  };
  warnings: string[];
};

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
  fallback: number
) {
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
  if (!item) return null;

  const id = text(item.id);
  const name = text(item.name ?? item.title);
  return id || name ? { id, name } : null;
}

function dateOnly(value: unknown): string | null {
  const result = text(value)?.slice(0, 10) ?? null;

  return result && /^\d{4}-\d{2}-\d{2}$/.test(result)
    ? result
    : null;
}

function validateDate(
  value: string | undefined,
  fieldName: string
) {
  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `${fieldName} must use YYYY-MM-DD.`
    );
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);
  const parsed = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(
      `${fieldName} is not a valid calendar date.`
    );
  }

  return value;
}

export function toSafePaymentPlan(
  item: BlikkRawItem
): SafePaymentPlan {
  const id = text(item.id);

  if (!id) {
    throw new Error(
      "Blikk returned a payment plan without an id."
    );
  }

  const price = numberValue(item.price, 0);
  const units = numberValue(item.units, 1);
  const invoiceId = text(item.invoiceId);
  const invoicedDate = dateOnly(item.invoicedDate);
  const invoiceDraftId = text(item.invoiceDraftId);
  const isInvoiced = Boolean(invoiceId || invoicedDate);

  return {
    id,
    articleNumber: text(item.articleNumber),
    description: text(item.description),
    price,
    units,
    amount: price * units,
    batchId: text(item.batchId),
    plannedInvoiceDate: dateOnly(item.date),
    invoiceId,
    invoicedDate,
    invoiceDraftId,
    project: nameId(item.project),
    createdDate: text(item.createdDate),
    updatedDate: text(item.updatedDate),
    classification: isInvoiced
      ? "invoiced"
      : invoiceDraftId
        ? "in_invoice_draft"
        : "not_invoiced_without_draft",
  };
}

export async function getAllSafePaymentPlans() {
  const response = await getAllPaymentPlans({});

  return {
    pagesFetched: response.pagesFetched,
    itemCount: response.items.length,
    items: response.items.map(toSafePaymentPlan),
  };
}

function sum(items: SafePaymentPlan[]) {
  return items.reduce(
    (total, item) => total + item.amount,
    0
  );
}

function byPlannedYear(items: SafePaymentPlan[]) {
  const groups = new Map<
    string,
    { plans: number; amount: number }
  >();

  for (const item of items) {
    const year =
      item.plannedInvoiceDate?.slice(0, 4) ??
      "date_missing";
    const current = groups.get(year) ?? {
      plans: 0,
      amount: 0,
    };

    current.plans += 1;
    current.amount += item.amount;
    groups.set(year, current);
  }

  return [...groups.entries()]
    .map(([year, values]) => ({
      year,
      ...values,
    }))
    .sort((left, right) =>
      left.year.localeCompare(right.year, "sv")
    );
}

export async function inspectUninvoicedPaymentPlans(
  options: {
    project: string;
    plannedFrom?: string;
    plannedTo?: string;
  }
): Promise<UninvoicedPaymentPlanDiagnostic> {
  const requestedProject = options.project.trim();

  if (!requestedProject) {
    throw new Error("A project is required.");
  }

  const plannedFrom = validateDate(
    options.plannedFrom,
    "plannedFrom"
  );
  const plannedTo = validateDate(
    options.plannedTo,
    "plannedTo"
  );

  if (
    plannedFrom &&
    plannedTo &&
    plannedFrom > plannedTo
  ) {
    throw new Error(
      "plannedFrom must be before or equal to plannedTo."
    );
  }

  const project = await resolveProject(requestedProject);
  const response = await getAllPaymentPlans({
    projectId: project.id,
  });
  const allPaymentPlans = response.items.map(
    toSafePaymentPlan
  );
  const paymentPlans = allPaymentPlans.filter((item) => {
    if (!plannedFrom && !plannedTo) return true;
    if (!item.plannedInvoiceDate) return false;
    if (
      plannedFrom &&
      item.plannedInvoiceDate < plannedFrom
    ) {
      return false;
    }
    if (
      plannedTo &&
      item.plannedInvoiceDate > plannedTo
    ) {
      return false;
    }
    return true;
  });

  const invoiced = paymentPlans.filter(
    (item) => item.classification === "invoiced"
  );
  const inInvoiceDraft = paymentPlans.filter(
    (item) =>
      item.classification === "in_invoice_draft"
  );
  const withoutInvoiceDraft = paymentPlans.filter(
    (item) =>
      item.classification ===
      "not_invoiced_without_draft"
  );
  const uninvoiced = [
    ...inInvoiceDraft,
    ...withoutInvoiceDraft,
  ];
  const uninvoicedAmount = sum(uninvoiced);
  const warnings = [
    "Diagnostic read-only output. No Blikk data is changed.",
    "An uninvoiced payment plan is a candidate order-stock signal, not automatically authoritative sold-not-invoiced revenue.",
    "The candidate amount includes payment plans in invoice drafts and payment plans without invoice drafts.",
    "Accepted offers are not included and must not be added automatically because that can double count the same sale.",
    "The result must be validated against a known project before it is added to the Sales Summary forecast.",
  ];

  if (plannedFrom || plannedTo) {
    warnings.push(
      "The date filter was applied locally to the payment plan date after all payment plans for the project were fetched. Rows without a planned invoice date were excluded."
    );
  }

  if (
    paymentPlans.some(
      (item) => item.plannedInvoiceDate === null
    )
  ) {
    warnings.push(
      "One or more payment plans lack a planned invoice date."
    );
  }

  return {
    diagnosticVersion:
      "uninvoiced-payment-plans-v1",
    generatedAt: new Date().toISOString(),
    requestedProject,
    projectId: project.id,
    projectName: project.title,
    currency: "SEK",
    filters: {
      plannedFrom,
      plannedTo,
    },
    totals: {
      paymentPlans: paymentPlans.length,
      amount: sum(paymentPlans),
      invoicedPlans: invoiced.length,
      invoicedAmount: sum(invoiced),
      uninvoicedPlans: uninvoiced.length,
      uninvoicedAmount,
      plansInInvoiceDraft: inInvoiceDraft.length,
      amountInInvoiceDraft: sum(inInvoiceDraft),
      plansWithoutInvoiceDraft:
        withoutInvoiceDraft.length,
      amountWithoutInvoiceDraft: sum(
        withoutInvoiceDraft
      ),
    },
    byPlannedYear: byPlannedYear(uninvoiced),
    paymentPlans: paymentPlans.sort((left, right) =>
      (left.plannedInvoiceDate ?? "9999-12-31")
        .localeCompare(
          right.plannedInvoiceDate ?? "9999-12-31"
        )
    ),
    interpretation: {
      candidateSoldNotInvoicedAmount:
        uninvoicedAmount,
      acceptedAsAuthoritativeSoldNotInvoiced: false,
      reason:
        "BK must confirm that uninvoiced payment plans represent confirmed sales and define whether invoice-draft rows should be included.",
    },
    warnings,
  };
}

