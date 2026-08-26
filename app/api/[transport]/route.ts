import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getUser,
  getAllUsers,
  getAllProjects,
  getAllTimeReports,
  getAllUserDayStatistics,
  getProjectTimeCalculation,
  getAllUsersWithResourcePlanning,
  getAllPlanningSummariesForUser,
  getAllOpportunityStatuses,
  getAllOpportunityTags,
  getOpportunity,
  getAllContacts,
  getContact,
} from "../../../lib/blikk/endpoints";
import {
  resolvePlanningUserId,
  resolveProjectId,
  resolveUserId,
} from "../../../lib/blikk/resolvers";
import {
  auditProjectBudgetTags,
  getAllActiveProjectBudgetStatuses,
  getProjectBudgetStatus,
  getProjectBudgetStatusExcludingUsers,
} from "../../../lib/blikk/budget";
import { getProjectCatalogView } from "../../../lib/blikk/project-catalog";
import { inspectProjectFinanceSources } from "../../../lib/blikk/project-finance";
import { inspectUninvoicedPaymentPlans } from "../../../lib/blikk/uninvoiced-payment-plans";
import { getClassifiedPlanningSummariesForUser } from "../../../lib/blikk/planning";
import {
  getOpportunityPipeline,
  toSafeOpportunity,
} from "../../../lib/blikk/opportunities";
import { toSafeContact } from "../../../lib/blikk/contacts";
import {
  analyzeCustomerOpportunity,
  getDormantCustomerOpportunities,
  getDormantCustomerIndexStatus,
  refreshDormantCustomerIndex,
} from "../../../lib/blikk/dormant-customers";
import { testGoogleSheetConnection } from "../../../lib/google/sheets";
import {
  getCustomerInvoiceSummary,
  getOfferPipeline,
} from "../../../lib/blikk/sales";
import { getCustomerSalesSnapshot } from "../../../lib/blikk/customer-sales";
import {
  getSalesSummaryIndex,
  getSalesSummaryIndexStatus,
  refreshSalesSummaryIndex,
} from "../../../lib/blikk/sales-summary-index";
import { getSalesSummaryWeeklyComparison } from "../../../lib/blikk/sales-summary-weekly";

export const maxDuration = 300;

const blikkDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const commaSeparatedIdsSchema = z
  .string()
  .regex(/^\d+(,\d+)*$/, "Use comma-separated numeric IDs.");

type BlikkUserMetadata =
  | string
  | {
      id?: number | string | null;
      name?: string | null;
      title?: string | null;
      color?: string | null;
    };

type BlikkUserDetail = {
  id: number | string;
  firstName?: string | null;
  lastName?: string | null;
  license?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  department?: BlikkUserMetadata | null;
  costCenter?: BlikkUserMetadata | null;
  salaryType?: string | number | null;
  costPerHour?: number | null;
  schedule?: BlikkUserMetadata | null;
  planningCapacityInPercent?: number | null;
  tags?: BlikkUserMetadata[] | null;
  isRestricted?: boolean | null;
};

type SafeMetadata = {
  id: string | null;
  name: string;
  color: string | null;
};

function toSafeMetadata(
  value: BlikkUserMetadata | null | undefined
): SafeMetadata | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const name = value.trim();

    return name
      ? {
          id: null,
          name,
          color: null,
        }
      : null;
  }

  const name = (value.name ?? value.title ?? "").trim();

  if (!name) {
    return null;
  }

  return {
    id:
      value.id !== undefined && value.id !== null
        ? String(value.id)
        : null,
    name,
    color: value.color ?? null,
  };
}

function createSafeUserProfile(
  requestedUser: string,
  detail: BlikkUserDetail
) {
  const userName = `${detail.firstName ?? ""} ${
    detail.lastName ?? ""
  }`.trim();

  const tags = (detail.tags ?? [])
    .map(toSafeMetadata)
    .filter((tag): tag is SafeMetadata => tag !== null);

  return {
    requestedUser,
    userId: String(detail.id),
    userName,
    tags,
    tagNames: tags.map((tag) => tag.name),
    costPerHour:
      typeof detail.costPerHour === "number"
        ? detail.costPerHour
        : null,
    planningCapacityInPercent:
      typeof detail.planningCapacityInPercent === "number"
        ? detail.planningCapacityInPercent
        : null,
    department: toSafeMetadata(detail.department),
    costCenter: toSafeMetadata(detail.costCenter),
    salaryType: detail.salaryType ?? null,
    schedule: toSafeMetadata(detail.schedule),
    license: detail.license ?? null,
    startDate: detail.startDate ?? null,
    endDate: detail.endDate ?? null,
    isRestricted: detail.isRestricted ?? null,
  };
}

const handler = createMcpHandler(
  (server) => {
    console.log(":rocket: MCP server initialized");

    server.registerTool(
      "health_check",
      {
        title: "Health Check",
        description: "Checks that the MCP server is alive and well.",
        inputSchema: {},
      },
      async () => {
        console.log(":white_check_mark: health_check called");

        return {
          content: [
            {
              type: "text",
              text: "MCP server is alive :rocket: | build: project-finance-diagnostics-v1",
            },
          ],
        };
      }
    );

    server.registerTool(
      "test_google_sheet_connection",
      {
        title: "Test Google Sheet Connection",
        description:
          "Tests read-only access to the configured Google Sheet. Returns spreadsheet and tab names, dimensions, populated row and column counts, and headers only. It never returns credentials or full sheet contents.",
        inputSchema: {},
      },
      async () => {
        console.log(
          ":arrow_right: test_google_sheet_connection tool invoked"
        );

        try {
          const result = await testGoogleSheetConnection();

          console.log(
            ":white_check_mark: testGoogleSheetConnection() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: test_google_sheet_connection failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Google Sheets error: ${error.message}`
                    : "Unknown Google Sheets error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_customer_invoices",
      {
        title: "Get Customer Invoices",
        description:
          "Returns read-only Blikk customer invoices and totals excluding VAT. Optionally filters by numeric Blikk customer ID and invoice year. The total represents invoiced sales, not supplier costs.",
        inputSchema: {
          customerId: z
            .string()
            .regex(/^\d+$/, "Use a numeric Blikk customer ID.")
            .optional(),
          year: z
            .number()
            .int()
            .min(2000)
            .max(2100)
            .optional(),
        },
      },
      async ({ customerId, year }) => {
        console.log(
          ":arrow_right: get_customer_invoices tool invoked"
        );

        try {
          const result = await getCustomerInvoiceSummary({
            customerId,
            year,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_customer_invoices failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk invoice error: ${error.message}`
                    : "Unknown Blikk invoice error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_offers",
      {
        title: "Get Offers",
        description:
          "Returns a read-only Blikk offer pipeline. Totals use only the latest version of each offer number to avoid double counting. Separates active, accepted, denied and draft offers. Accepted offer value is not automatically treated as sold-not-invoiced.",
        inputSchema: {
          state: z
            .enum([
              "draft",
              "locked",
              "sentToCustomer",
              "openedByCustomer",
              "accepted",
              "acceptedSigned",
              "denied",
            ])
            .optional(),
          opportunityId: z
            .string()
            .regex(/^\d+$/, "Use a numeric opportunity ID.")
            .optional(),
          offerNumber: z
            .string()
            .regex(/^\d+$/, "Use a numeric offer number.")
            .optional(),
          createdFrom: blikkDateSchema.optional(),
          createdTo: blikkDateSchema.optional(),
          updatedFrom: blikkDateSchema.optional(),
          updatedTo: blikkDateSchema.optional(),
          sortBy: z
            .enum([
              "title",
              "offerNumber",
              "createdDate",
              "updatedDate",
            ])
            .optional(),
          sortOrder: z
            .enum(["ascending", "descending"])
            .optional(),
        },
      },
      async (input) => {
        console.log(":arrow_right: get_offers tool invoked");

        try {
          const result = await getOfferPipeline({
            offerState: input.state,
            opportunityId: input.opportunityId,
            offerNumber: input.offerNumber,
            createdDateFrom: input.createdFrom,
            createdDateTo: input.createdTo,
            updatedDateFrom: input.updatedFrom,
            updatedDateTo: input.updatedTo,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(":x: get_offers failed:", error);

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk offer error: ${error.message}`
                    : "Unknown Blikk offer error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_customer_sales_snapshot",
      {
        title: "Get Customer Sales Snapshot",
        description:
          "Builds a read-only sales snapshot for one Blikk customer ID. Combines customer invoices, projects, opportunities and offers; calculates invoiced sales, pipeline and weighted pipeline; and reports data-quality flags. Sold-not-invoiced, annual budget and budget gap remain null until their authoritative sources are configured.",
        inputSchema: {
          customerId: z
            .string()
            .regex(/^\d+$/, "Use a numeric Blikk customer ID."),
          year: z
            .number()
            .int()
            .min(2000)
            .max(2100)
            .optional(),
          staleOfferDays: z
            .number()
            .int()
            .min(1)
            .max(3650)
            .optional(),
        },
      },
      async ({ customerId, year, staleOfferDays }) => {
        console.log(
          ":arrow_right: get_customer_sales_snapshot tool invoked"
        );

        try {
          const result = await getCustomerSalesSnapshot({
            customerId,
            year,
            staleOfferDays,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_customer_sales_snapshot failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Customer sales snapshot error: ${error.message}`
                    : "Unknown customer sales snapshot error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "refresh_sales_summary_index",
      {
        title: "Refresh Sales Summary Index",
        description:
          "Starts or continues the private Sales Summary index. The build is incremental and safe to resume. Call repeatedly until complete is true, or let the configured cron job continue it. Use reset only when intentionally starting a new build.",
        inputSchema: {
          reportYear: z
            .number()
            .int()
            .min(2000)
            .max(2100)
            .optional(),
          opportunityBatchSize: z
            .number()
            .int()
            .min(1)
            .max(30)
            .optional(),
          reset: z.boolean().optional(),
        },
      },
      async ({
        reportYear,
        opportunityBatchSize,
        reset,
      }) => {
        try {
          const result = await refreshSalesSummaryIndex({
            reportYear,
            opportunityBatchSize,
            reset,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Sales Summary index error: ${error.message}`
                    : "Unknown Sales Summary index error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_sales_summary_index_status",
      {
        title: "Get Sales Summary Index Status",
        description:
          "Reads the current private Sales Summary build state without starting or changing the build. Returns phase, percentage, source counts, opportunity-detail progress, failures and timestamps.",
        inputSchema: {},
      },
      async () => {
        try {
          const result = await getSalesSummaryIndexStatus();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Sales Summary status error: ${error.message}`
                    : "Unknown Sales Summary status error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_sales_summary",
      {
        title: "Get Sales Summary",
        description:
          "Reads the latest completed private Sales Summary index without rescanning Blikk. Returns agency totals, totals by responsible person, customer summaries, Sales Attention signals and data-quality flags. Optionally filters customers by customer name, Blikk customer ID or responsible person. Sold-not-invoiced, annual budget and budget gap remain null until authoritative sources are connected.",
        inputSchema: {
          customer: z.string().trim().min(1).optional(),
          responsible: z.string().trim().min(1).optional(),
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional(),
        },
      },
      async ({ customer, responsible, limit }) => {
        try {
          const result = await getSalesSummaryIndex({
            customer,
            responsible,
            limit,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Sales Summary error: ${error.message}`
                    : "Unknown Sales Summary error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_sales_data_quality",
      {
        title: "Get Sales Data Quality",
        description:
          "Reads the enhanced data-quality audit from the latest completed private Sales Summary index. Returns duplicate-customer warnings and quality flags for customers, projects, open opportunities and offers. It does not rescan Blikk or change any data.",
        inputSchema: {
          severity: z
            .enum(["warning", "error"])
            .optional(),
          code: z.string().trim().min(1).optional(),
          entityType: z
            .enum([
              "customer",
              "project",
              "opportunity",
              "offer",
            ])
            .optional(),
          customer: z.string().trim().min(1).optional(),
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional(),
        },
      },
      async ({
        severity,
        code,
        entityType,
        customer,
        limit,
      }) => {
        try {
          const summary = await getSalesSummaryIndex({
            limit: 1,
          });
          const audit = summary.dataQuality.audit;

          if (!audit) {
            throw new Error(
              "Det senaste färdiga Sales Summary-indexet saknar den utökade datakvalitetsgranskningen. Låt den aktuella indexeringen slutföras och försök sedan igen."
            );
          }

          const normalizedCode =
            code?.trim().toLocaleUpperCase("sv");
          const normalizedCustomer =
            customer?.trim().toLocaleLowerCase("sv");
          const filteredFlags = audit.flags
            .filter(
              (flag) =>
                !severity ||
                flag.severity === severity
            )
            .filter(
              (flag) =>
                !normalizedCode ||
                flag.code.toLocaleUpperCase("sv") ===
                  normalizedCode
            )
            .filter(
              (flag) =>
                !entityType ||
                flag.entityType === entityType
            )
            .filter((flag) => {
              if (!normalizedCustomer) return true;

              return (
                flag.customerId === customer ||
                (flag.customerName ?? "")
                  .toLocaleLowerCase("sv")
                  .includes(normalizedCustomer)
              );
            });

          const returnedFlags = filteredFlags.slice(
            0,
            limit ?? 100
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    generatedAt: audit.generatedAt,
                    filters: {
                      severity: severity ?? null,
                      code: normalizedCode ?? null,
                      entityType: entityType ?? null,
                      customer: customer ?? null,
                    },
                    totals: {
                      allFlags: audit.totalFlags,
                      errors: audit.errorCount,
                      warnings: audit.warningCount,
                      matchingFlags: filteredFlags.length,
                      returnedFlags:
                        returnedFlags.length,
                    },
                    countsByCode:
                      audit.countsByCode,
                    flags: returnedFlags,
                    limitations: audit.limitations,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Sales data-quality error: ${error.message}`
                    : "Unknown Sales data-quality error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_sales_summary_weekly_comparison",
      {
        title: "Get Sales Summary Weekly Comparison",
        description:
          "Compares two completed private Sales Summary snapshots from different ISO weeks. Returns agency-level changes, changed customers, new/won/lost opportunities, offer transitions and weekly Sales Attention. It never invents sold-not-invoiced, annual budget or budget gap when those sources are unavailable.",
        inputSchema: {
          week: z
            .string()
            .regex(
              /^\\d{4}-W\\d{2}$/,
              "Use ISO week format YYYY-Www, for example 2026-W34."
            )
            .optional(),
          customerLimit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional(),
        },
      },
      async ({ week, customerLimit }) => {
        try {
          const result =
            await getSalesSummaryWeeklyComparison({
              week,
              customerLimit,
            });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Sales Summary weekly comparison error: ${error.message}`
                    : "Unknown Sales Summary weekly comparison error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "inspect_uninvoiced_payment_plans",
      {
        title: "Inspect Uninvoiced Payment Plans",
        description:
          "Reads all Blikk payment plans for one resolved project and separates invoiced rows, rows in invoice drafts and rows without invoices or drafts. Returns a candidate sold-not-invoiced amount for validation only. It never changes Blikk data and does not treat the candidate as authoritative sales.",
        inputSchema: {
          project: z.string().trim().min(1),
          plannedFrom: blikkDateSchema.optional(),
          plannedTo: blikkDateSchema.optional(),
        },
      },
      async ({
        project,
        plannedFrom,
        plannedTo,
      }) => {
        console.log(
          ":arrow_right: inspect_uninvoiced_payment_plans tool invoked"
        );

        try {
          const result =
            await inspectUninvoicedPaymentPlans({
              project,
              plannedFrom,
              plannedTo,
            });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: inspect_uninvoiced_payment_plans failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Uninvoiced payment-plan error: ${error.message}`
                    : "Unknown uninvoiced payment-plan error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "inspect_project_finance_sources",
      {
        title: "Inspect Project Finance Sources",
        description:
          "Inspects supplier invoices, payment plans and material reports for a Blikk project. Returns diagnostic source data only and does not calculate authoritative revenue, cost, profit or gross margin. Optional dates use YYYY-MM-DD. The requested period is applied to supplier invoice dates; payment plans and material reports are returned for the full project because their list endpoints have no verified business-date filter.",
        inputSchema: {
          project: z.string(),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
        },
      },
      async ({ project, fromDate, toDate }) => {
        console.log(
          ":arrow_right: inspect_project_finance_sources tool invoked"
        );

        try {
          const diagnostics = await inspectProjectFinanceSources(
            project,
            fromDate,
            toDate
          );

          console.log(
            ":white_check_mark: inspectProjectFinanceSources() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(diagnostics, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: inspect_project_finance_sources failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_users",
      {
        title: "Get Users",
        description:
          "Without a user name, fetches all users from Blikk. With user, resolves a full or unique partial name and returns a privacy-safe detailed profile with tags, cost per hour, planning capacity, department, cost center, salary type and schedule.",
        inputSchema: {
          user: z.string().optional(),
        },
      },
      async ({ user }) => {
        console.log(":arrow_right: get_users tool invoked");

        try {
          if (user) {
            console.log(
              ":arrow_right: Resolving user name to Blikk user ID"
            );

            const userId = await resolveUserId(user);

            console.log(
              `:white_check_mark: Resolved '${user}' to user ID ${userId}`
            );
            console.log(":arrow_right: Calling getUser()");

            const detail = (await getUser(userId)) as BlikkUserDetail;

            if (!detail || detail.id === undefined || detail.id === null) {
              throw new Error(
                `Blikk returned an unexpected user detail response for user ID ${userId}.`
              );
            }

            const profile = createSafeUserProfile(user, detail);

            console.log(
              ":white_check_mark: get_users detailed profile completed"
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(profile, null, 2),
                },
              ],
            };
          }

          console.log(":arrow_right: Calling getAllUsers()");

          const users = await getAllUsers();

          console.log(":white_check_mark: getAllUsers() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(users, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(":x: get_users failed:", error);

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_users_with_resource_planning",
      {
        title: "Get Users With Resource Planning",
        description:
          "Returns all Blikk users who have resource planning within an inclusive date range. Dates must use the YYYY-MM-DD format.",
        inputSchema: {
          fromDate: z.string(),
          toDate: z.string(),
        },
      },
      async ({ fromDate, toDate }) => {
        console.log(
          ":arrow_right: get_users_with_resource_planning tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getAllUsersWithResourcePlanning()"
          );

          const users = await getAllUsersWithResourcePlanning({
            fromDate,
            toDate,
          });

          console.log(
            ":white_check_mark: getAllUsersWithResourcePlanning() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(users, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_users_with_resource_planning failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_user_planning_summaries",
      {
        title: "Get User Planning Summaries",
        description:
          "Returns a Blikk user's planned hours grouped by project for an inclusive date range. The complete fetched result is split into regularProjects and noindexProjects; NOINDEX projects remain visible but are kept separate from the ordinary planning result. Accepts a full name or a unique partial name, such as 'Richard'. Dates must use the YYYY-MM-DD format.",
        inputSchema: {
          user: z.string(),
          fromDate: z.string(),
          toDate: z.string(),
        },
      },
      async ({ user, fromDate, toDate }) => {
        console.log(
          ":arrow_right: get_user_planning_summaries tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Resolving user name to Blikk user ID"
          );

          const userId = await resolvePlanningUserId(
            user,
            fromDate,
            toDate
          );

          console.log(
            `:white_check_mark: Resolved '${user}' to user ID ${userId}`
          );

          console.log(
            ":arrow_right: Calling getAllPlanningSummariesForUser()"
          );

          const fetchedSummaries = await getAllPlanningSummariesForUser({
            userId,
            fromDate,
            toDate,
          });

          const summaries = await getClassifiedPlanningSummariesForUser(
            fetchedSummaries
          );

          console.log(
            ":white_check_mark: getAllPlanningSummariesForUser() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    requestedUser: user,
                    resolvedUserId: userId,
                    fromDate,
                    toDate,
                    summaries,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_user_planning_summaries failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_projects",
      {
        title: "Get Projects",
        description:
          "Fetches every project from Blikk by automatically retrieving and combining all API pages.",
        inputSchema: {},
      },
      async () => {
        console.log(":arrow_right: get_projects tool invoked");

        try {
          console.log(":arrow_right: Calling getAllProjects()");

          const projects = await getAllProjects();

          console.log(":white_check_mark: getAllProjects() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(projects, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(":x: get_projects failed:", error);

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "list_project_statuses",
      {
        title: "List Project Statuses",
        description:
          "Returns a status summary and every matching project from the complete Blikk project catalog. All internal result pages are automatically combined. Set isCompleted to false to return every project that is not completed.",
        inputSchema: {
          isCompleted: z.boolean().optional(),
        },
      },
      async ({ isCompleted }) => {
        console.log(
          ":arrow_right: list_project_statuses tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getProjectCatalogView()"
          );

          const firstResult = await getProjectCatalogView({
            isCompleted,
            page: 1,
            pageSize: 300,
          });

          const projects = [...firstResult.projects];
          const sourceTotalPages = firstResult.totalPages;

          for (let page = 2; page <= sourceTotalPages; page += 1) {
            const nextResult = await getProjectCatalogView({
              isCompleted,
              page,
              pageSize: 300,
            });

            projects.push(...nextResult.projects);
          }

          const result = {
            ...firstResult,
            page: 1,
            totalPages: sourceTotalPages,
            pagesFetched: sourceTotalPages,
            isComplete: true,
            returnedProjects: projects.length,
            projects,
          };

          console.log(
            ":white_check_mark: getProjectCatalogView() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: list_project_statuses failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_time_reports",
      {
        title: "Get Time Reports",
        description:
          "Fetches all matching time reports from Blikk by automatically retrieving and combining every API page.",
        inputSchema: {
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
          userId: z.string().optional(),
          projectId: z.string().optional(),
        },
      },
      async ({ fromDate, toDate, userId, projectId }) => {
        console.log(":arrow_right: get_time_reports tool invoked");

        try {
          console.log(":arrow_right: Calling getAllTimeReports()");

          const reports = await getAllTimeReports({
            fromDate,
            toDate,
            userId,
            projectId,
          });

          console.log(":white_check_mark: getAllTimeReports() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(reports, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(":x: get_time_reports failed:", error);

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_user_day_statistics",
      {
        title: "Get User Day Statistics",
        description:
          "Fetches all matching daily user statistics from Blikk by automatically retrieving and combining every API page.",
        inputSchema: {
          fromDate: z.string(),
          toDate: z.string(),
          userId: z.string().optional(),
        },
      },
      async ({ fromDate, toDate, userId }) => {
        console.log(
          ":arrow_right: get_user_day_statistics tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getAllUserDayStatistics()"
          );

          const statistics = await getAllUserDayStatistics({
            fromDate,
            toDate,
            userId,
          });

          console.log(
            ":white_check_mark: getAllUserDayStatistics() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(statistics, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_user_day_statistics failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_project_time_calculation",
      {
        title: "Get Project Time Calculation",
        description:
          "Fetches the total number of planned or calculated hours for a specific project in Blikk. This tool does not calculate reported hours, remaining hours or percentages. Use get_project_budget_status for complete budget status.",
        inputSchema: {
          project: z.string(),
        },
      },
      async ({ project }) => {
        console.log(
          ":arrow_right: get_project_time_calculation tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Resolving project name to project ID"
          );

          const projectId = await resolveProjectId(project);

          console.log(
            ":arrow_right: Calling getProjectTimeCalculation()"
          );

          const calculation =
            await getProjectTimeCalculation(projectId);

          console.log(
            ":white_check_mark: getProjectTimeCalculation() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(calculation, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_project_time_calculation failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_project_budget_status",
      {
        title: "Get Project Budget Status",
        description:
          "Calculates budget status according to the project's budget tag: Timbank, Projekt, Retainer or Löpande. For Retainer projects, fromDate and toDate select the reporting period and every calendar month touched counts as one full monthly budget. Without dates, the current calendar month is used. Dates must use YYYY-MM-DD.",
        inputSchema: {
          project: z.string(),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
        },
      },
      async ({ project, fromDate, toDate }) => {
        console.log(
          ":arrow_right: get_project_budget_status tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getProjectBudgetStatus()"
          );

          const budgetStatus = await getProjectBudgetStatus(
            project,
            fromDate,
            toDate
          );

          console.log(
            ":white_check_mark: getProjectBudgetStatus() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(budgetStatus, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_project_budget_status failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_project_budget_status_excluding_users",
      {
        title: "Get Project Budget Status Excluding Users",
        description:
          "Calculates budget status after excluding selected users and/or users with selected employee tags, using the project's Timbank, Projekt, Retainer or Löpande tag. Use excludeUsers for names and excludeUserTags for tags such as Praktikant. A user matched by both is only excluded once. For Retainer projects, fromDate and toDate select the period and every calendar month touched counts as one full monthly budget. Without dates, the current calendar month is used. Dates must use YYYY-MM-DD.",
        inputSchema: {
          project: z.string(),
          excludeUsers: z.array(z.string()).optional(),
          excludeUserTags: z.array(z.string()).optional(),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
        },
      },
      async ({
        project,
        excludeUsers,
        excludeUserTags,
        fromDate,
        toDate,
      }) => {
        console.log(
          ":arrow_right: get_project_budget_status_excluding_users tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getProjectBudgetStatusExcludingUsers()"
          );

          const budgetStatus =
            await getProjectBudgetStatusExcludingUsers(
              project,
              excludeUsers ?? [],
              fromDate,
              toDate,
              excludeUserTags ?? []
            );

          console.log(
            ":white_check_mark: getProjectBudgetStatusExcludingUsers() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(budgetStatus, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_project_budget_status_excluding_users failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_all_active_project_budget_statuses",
      {
        title: "Get All Active Project Budget Statuses",
        description:
          "Builds a complete time budget report for every active project in Blikk. Returns project status, project manager, budget hours, reported hours, remaining hours, percentages and over-budget status. The first run can take several minutes; completed reports are cached for 30 minutes.",
        inputSchema: {},
      },
      async () => {
        console.log(
          ":arrow_right: get_all_active_project_budget_statuses tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getAllActiveProjectBudgetStatuses()"
          );

          const report =
            await getAllActiveProjectBudgetStatuses();

          console.log(
            ":white_check_mark: getAllActiveProjectBudgetStatuses() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(report, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: get_all_active_project_budget_statuses failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "search_contacts",
      {
        title: "Search Contacts",
        description:
          "Searches Blikk contacts by name or customer number and returns privacy-conscious contact cards. Sensitive identity numbers and full addresses are never returned.",
        inputSchema: {
          query: z.string().trim().min(2),
          contactType: z.enum(["person", "company"]).optional(),
          relation: z
            .enum(["customer", "supplier", "wholesale", "retail", "subcontractor", "partner"])
            .optional(),
        },
      },
      async ({ query, contactType, relation }) => {
        try {
          const contacts = await getAllContacts({
            query,
            contactType,
            relations: relation,
          });
          const result = contacts.items.map(toSafeContact);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_contact",
      {
        title: "Get Contact",
        description:
          "Returns a privacy-conscious Blikk contact card by numeric ID. Sensitive identity numbers and full addresses are excluded.",
        inputSchema: {
          contactId: z.string().regex(/^\d+$/, "Use a numeric contact ID."),
        },
      },
      async ({ contactId }) => {
        try {
          const result = toSafeContact(await getContact(contactId));
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "refresh_dormant_customer_index",
      {
        title: "Refresh Dormant Customer Index",
        description:
          "Builds the private dormant-customer index incrementally to avoid timeouts. Call repeatedly with the same years value until complete is true. Use reset only to intentionally start a new build. Do not run refresh calls in parallel.",
        inputSchema: {
          years: z.number().int().min(1).max(10).optional(),
          batchSize: z.number().int().min(1).max(30).optional(),
          reset: z.boolean().optional(),
        },
      },
      async ({ years, batchSize, reset }) => {
        try {
          const result = await refreshDormantCustomerIndex({
            years,
            batchSize,
            reset,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_dormant_customer_index_status",
      {
        title: "Get Dormant Customer Index Status",
        description:
          "Reads the current private Blob build state without starting or changing an index build. Returns phase, processed and total records, percentage, failures, timestamps and whether the index is complete.",
        inputSchema: {},
      },
      async () => {
        try {
          const result = await getDormantCustomerIndexStatus();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blob index error: ${error.message}`
                : "Unknown Blob index error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_dormant_customer_opportunities",
      {
        title: "Get Dormant Customer Opportunities",
        description:
          "Reads the latest completed private customer index without scanning Blikk. Optionally filters by customer name and limits the number of recommendations. Recommendation scores are sales signals, not factual predictions.",
        inputSchema: {
          customer: z.string().trim().min(2).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ customer, limit }) => {
        try {
          const result = await getDormantCustomerOpportunities({ customer, limit });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "analyze_customer_opportunity",
      {
        title: "Analyze Customer Opportunity",
        description:
          "Quickly analyzes one uniquely matching project and its customer without rebuilding the global index. Verifies project completion and whether any time reports exist, then includes safe contact details and opportunity history.",
        inputSchema: {
          project: z.string().trim().min(2),
        },
      },
      async ({ project }) => {
        try {
          const result = await analyzeCustomerOpportunity(project);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_opportunities",
      {
        title: "Get Opportunities",
        description:
          "Returns a complete, privacy-conscious Blikk opportunity pipeline. Supports Blikk's read-only state, status, tag, offer and date filters. Includes totals grouped by state, status and responsible user, plus the matching opportunities. Dates use YYYY-MM-DD; statusIds and tagIds are comma-separated numeric IDs.",
        inputSchema: {
          state: z.enum(["open", "won", "lost"]).optional(),
          statusIds: commaSeparatedIdsSchema.optional(),
          tagIds: commaSeparatedIdsSchema.optional(),
          hasOffers: z.boolean().optional(),
          createdFrom: blikkDateSchema.optional(),
          createdTo: blikkDateSchema.optional(),
          updatedFrom: blikkDateSchema.optional(),
          updatedTo: blikkDateSchema.optional(),
          closedFrom: blikkDateSchema.optional(),
          closedTo: blikkDateSchema.optional(),
          estimatedClosingFrom: blikkDateSchema.optional(),
          estimatedClosingTo: blikkDateSchema.optional(),
          sortBy: z.enum(["title", "createdDate", "updatedDate"]).optional(),
          sortOrder: z.enum(["ascending", "descending"]).optional(),
        },
      },
      async (input) => {
        try {
          const result = await getOpportunityPipeline({
            opportunityState: input.state,
            opportunityStatusIds: input.statusIds,
            opportunityTagIds: input.tagIds,
            hasOffers: input.hasOffers,
            createdDateFrom: input.createdFrom,
            createdDateTo: input.createdTo,
            updatedDateFrom: input.updatedFrom,
            updatedDateTo: input.updatedTo,
            closedDateFrom: input.closedFrom,
            closedDateTo: input.closedTo,
            estimatedClosingDateFrom: input.estimatedClosingFrom,
            estimatedClosingDateTo: input.estimatedClosingTo,
            sortBy: input.sortBy ?? "updatedDate",
            sortOrder: input.sortOrder ?? "descending",
          });

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_opportunity",
      {
        title: "Get Opportunity",
        description:
          "Returns a read-only, privacy-conscious detailed Blikk opportunity, including description, probability, customer, responsible user, status, tags and any linked project.",
        inputSchema: {
          opportunityId: z.string().regex(/^\d+$/, "Use a numeric opportunity ID."),
        },
      },
      async ({ opportunityId }) => {
        try {
          const opportunity = await getOpportunity(opportunityId);
          const result = toSafeOpportunity(opportunity);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "get_opportunity_metadata",
      {
        title: "Get Opportunity Metadata",
        description:
          "Lists all Blikk opportunity statuses and tags so their IDs can be used with get_opportunities filters.",
        inputSchema: {},
      },
      async () => {
        try {
          const statuses = await getAllOpportunityStatuses();
          const tags = await getAllOpportunityTags();

          return {
            content: [{
              type: "text",
              text: JSON.stringify({ statuses: statuses.items, tags: tags.items }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error instanceof Error
                ? `Blikk error: ${error.message}`
                : "Unknown Blikk error",
            }],
            isError: true,
          };
        }
      }
    );

    server.registerTool(
      "audit_project_budget_tags",
      {
        title: "Audit Project Budget Tags",
        description:
          "Audits project labels used for budget classification. Returns projects with exactly one valid budget tag, projects missing a budget tag, projects with multiple conflicting budget tags, and counts for Timbank, Projekt, Retainer and Löpande. Other tags are ignored. By default only active projects are included.",
        inputSchema: {
          activeOnly: z.boolean().optional(),
        },
      },
      async ({ activeOnly }) => {
        console.log(
          ":arrow_right: audit_project_budget_tags tool invoked"
        );

        try {
          const report = await auditProjectBudgetTags(
            activeOnly ?? true
          );

          console.log(
            ":white_check_mark: auditProjectBudgetTags() completed"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(report, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(
            ":x: audit_project_budget_tags failed:",
            error
          );

          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? `Blikk error: ${error.message}`
                    : "Unknown Blikk error",
              },
            ],
          };
        }
      }
    );
  },
  {},
  {
    basePath: "/api",
    verboseLogs: true,
    maxDuration: 300,
  }
);

function isAuthorized(request: Request): boolean {
  const expectedApiKey = process.env.MCP_API_KEY;

  if (!expectedApiKey) {
    console.error("MCP_API_KEY is missing in Vercel");
    return false;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const providedApiKey = authorization.slice(7).trim();

  return providedApiKey === expectedApiKey;
}

function unauthorizedResponse(): Response {
  return Response.json(
    {
      error: "Unauthorized",
      message: "A valid Bearer token is required.",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate":
          'Bearer realm="operations-agent-mcp"',
      },
    }
  );
}

async function authenticatedHandler(
  request: Request
): Promise<Response> {
  if (!isAuthorized(request)) {
    console.warn("Unauthorized MCP request blocked");
    return unauthorizedResponse();
  }

  return handler(request);
}

export {
  authenticatedHandler as GET,
  authenticatedHandler as POST,
  authenticatedHandler as DELETE,
};







