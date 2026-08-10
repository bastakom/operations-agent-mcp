import {
  BlikkRawItem,
  CompletePagedResponse,
  getAllMaterialReports,
  getAllPaymentPlans,
  getAllSupplierInvoices,
} from "./endpoints";
import { resolveProject } from "./resolvers";

export type ProjectFinanceDiagnosticPeriod = {
  fromDate: string | null;
  toDate: string | null;
};

export type ProjectFinanceDiagnosticSource = {
  status: "ok" | "error";
  filterBasis: string;
  pagesFetched: number;
  itemCount: number;
  fieldNames: string[];
  items: BlikkRawItem[];
  error: string | null;
};

export type ProjectFinanceSourceDiagnostics = {
  diagnosticVersion: "project-finance-diagnostics-v1";
  generatedAt: string;
  requestedProject: string;
  projectId: string;
  projectName: string;
  period: ProjectFinanceDiagnosticPeriod;
  financialMetricsCalculated: false;
  sources: {
    supplierInvoices: ProjectFinanceDiagnosticSource;
    paymentPlans: ProjectFinanceDiagnosticSource;
    materialReports: ProjectFinanceDiagnosticSource;
  };
  warnings: string[];
};

const SUPPLIER_INVOICE_FIELDS = [
  "objectName",
  "id",
  "invoiceNumber",
  "invoiceDate",
  "title",
  "description",
  "totalAmount",
  "cost",
  "invoiceCostAddition",
  "toBeInvoiced",
  "invoiceId",
  "project",
  "supplier",
  "createdDate",
  "updatedDate",
] as const;

const PAYMENT_PLAN_FIELDS = [
  "objectName",
  "id",
  "articleNumber",
  "description",
  "price",
  "units",
  "batchId",
  "date",
  "invoiceId",
  "invoicedDate",
  "invoiceDraftId",
  "project",
  "createdDate",
  "updatedDate",
] as const;

const MATERIAL_REPORT_FIELDS = [
  "objectName",
  "id",
  "sortOrder",
  "articleNumber",
  "title",
  "description",
  "consumedUnits",
  "invoiceableUnits",
  "unitText",
  "costPerUnit",
  "pricePerUnit",
  "discountPercentage",
  "totalAmount",
  "toBeInvoiced",
  "invoiceId",
  "invoicedDate",
  "invoiceDraftId",
  "project",
  "timeReportId",
  "createdDate",
  "updatedDate",
] as const;

function parseDate(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must use the YYYY-MM-DD format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }

  return parsed;
}

function validatePeriod(fromDate?: string, toDate?: string): void {
  const parsedFromDate = fromDate
    ? parseDate(fromDate, "fromDate")
    : null;
  const parsedToDate = toDate ? parseDate(toDate, "toDate") : null;

  if (
    parsedFromDate &&
    parsedToDate &&
    parsedFromDate.getTime() > parsedToDate.getTime()
  ) {
    throw new Error("fromDate must be before or equal to toDate.");
  }
}

function sanitizeNestedValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (depth >= 3) {
    return "[nested value omitted]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeNestedValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: BlikkRawItem = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = sanitizeNestedValue(nestedValue, depth + 1);
    }

    return result;
  }

  return String(value);
}

function pickFields(
  item: BlikkRawItem,
  fields: readonly string[]
): BlikkRawItem {
  const result: BlikkRawItem = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      result[field] = sanitizeNestedValue(item[field]);
    }
  }

  return result;
}

function collectFieldNames(items: BlikkRawItem[]): string[] {
  const names = new Set<string>();

  for (const item of items) {
    for (const key of Object.keys(item)) {
      names.add(key);
    }
  }

  return [...names].sort((left, right) =>
    left.localeCompare(right, "en")
  );
}

async function inspectSource(
  load: () => Promise<CompletePagedResponse<BlikkRawItem>>,
  fields: readonly string[],
  filterBasis: string
): Promise<ProjectFinanceDiagnosticSource> {
  try {
    const response = await load();

    return {
      status: "ok",
      filterBasis,
      pagesFetched: response.pagesFetched,
      itemCount: response.items.length,
      fieldNames: collectFieldNames(response.items),
      items: response.items.map((item) => pickFields(item, fields)),
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      filterBasis,
      pagesFetched: 0,
      itemCount: 0,
      fieldNames: [],
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectProjectFinanceSources(
  projectName: string,
  fromDate?: string,
  toDate?: string
): Promise<ProjectFinanceSourceDiagnostics> {
  const requestedProject = projectName.trim();

  if (!requestedProject) {
    throw new Error("A project name is required.");
  }

  validatePeriod(fromDate, toDate);

  const project = await resolveProject(requestedProject);

  // Keep these calls sequential. Blikk rate-limits access tokens to four
  // requests per second, and each loader already handles paginated results.
  const supplierInvoices = await inspectSource(
    () =>
      getAllSupplierInvoices({
        projectId: project.id,
        invoiceDateFrom: fromDate,
        invoiceDateTo: toDate,
      }),
    SUPPLIER_INVOICE_FIELDS,
    fromDate || toDate
      ? "projectId and supplier invoice date"
      : "projectId"
  );

  const paymentPlans = await inspectSource(
    () => getAllPaymentPlans({ projectId: project.id }),
    PAYMENT_PLAN_FIELDS,
    "projectId; requested period not applied because Blikk exposes no payment-plan business-date filter"
  );

  const materialReports = await inspectSource(
    () => getAllMaterialReports({ projectId: project.id }),
    MATERIAL_REPORT_FIELDS,
    "projectId; requested period not applied because Blikk exposes no material-report business-date filter"
  );

  const warnings = [
    "Diagnostic output only. No field has yet been accepted as authoritative revenue or cost.",
    "Payment plans represent planned or invoiceable amounts and are not automatically actual revenue.",
    "Material report amounts are not automatically actual revenue or standalone cost.",
    "Supplier invoices and material reports may overlap; do not sum them before duplicate-source analysis is complete.",
  ];

  if (fromDate || toDate) {
    warnings.push(
      "The requested period was applied to supplier invoiceDate only. Payment plans and material reports were fetched for the full project because their list endpoints expose no verified business-date filter."
    );
  }

  for (const [sourceName, source] of Object.entries({
    supplierInvoices,
    paymentPlans,
    materialReports,
  })) {
    if (source.status === "error") {
      warnings.push(
        `${sourceName} could not be inspected: ${source.error ?? "unknown error"}`
      );
    }
  }

  return {
    diagnosticVersion: "project-finance-diagnostics-v1",
    generatedAt: new Date().toISOString(),
    requestedProject,
    projectId: project.id,
    projectName: project.title,
    period: {
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
    },
    financialMetricsCalculated: false,
    sources: {
      supplierInvoices,
      paymentPlans,
      materialReports,
    },
    warnings,
  };
}
