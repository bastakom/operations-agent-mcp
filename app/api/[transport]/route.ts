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

export const maxDuration = 300;

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
                text: "MCP server is alive :rocket: | build: user-tag-filter-v1",
            },
          ],
        };
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
          "Returns a Blikk user's planned hours grouped by project for an inclusive date range. Accepts a full name or a unique partial name, such as 'Richard'. Dates must use the YYYY-MM-DD format.",
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

          const summaries = await getAllPlanningSummariesForUser({
            userId,
            fromDate,
            toDate,
          });

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
