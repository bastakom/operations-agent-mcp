import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getUsers,
  getProjects,
  getTimeReports,
  getUserDayStatistics,
  getProjectTimeCalculation,
} from "../../../lib/blikk/endpoints";
import { resolveProjectId } from "../../../lib/blikk/resolvers";
import {
  getAllActiveProjectBudgetStatuses,
  getProjectBudgetStatus,
} from "../../../lib/blikk/budget";
import { getProjectCatalogView } from "../../../lib/blikk/project-catalog";

export const maxDuration = 300;

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
              text: "MCP server is alive :rocket:",
            },
          ],
        };
      }
    );

    server.registerTool(
      "get_users",
      {
        title: "Get Users",
        description: "Fetches all users from Blikk.",
        inputSchema: {},
      },
      async () => {
        console.log(":arrow_right: get_users tool invoked");

        try {
          console.log(":arrow_right: Calling getUsers()");

          const users = await getUsers();

          console.log(":white_check_mark: getUsers() completed");

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
      "get_projects",
      {
        title: "Get Projects",
        description:
          "Fetches the first page of up to 100 projects from Blikk.",
        inputSchema: {},
      },
      async () => {
        console.log(":arrow_right: get_projects tool invoked");

        try {
          console.log(":arrow_right: Calling getProjects()");

          const projects = await getProjects();

          console.log(":white_check_mark: getProjects() completed");

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
          "Returns a status summary and the first page of projects from the complete Blikk project catalog. Set isCompleted to false to return projects that are not completed.",
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

          const result = await getProjectCatalogView({
            isCompleted,
          });

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
        description: "Fetches time reports from Blikk.",
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
          console.log(":arrow_right: Calling getTimeReports()");

          const reports = await getTimeReports({
            fromDate,
            toDate,
            userId,
            projectId,
          });

          console.log(":white_check_mark: getTimeReports() completed");

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
        description: "Fetches daily statistics for a user from Blikk.",
        inputSchema: {
          fromDate: z.string(),
          toDate: z.string(),
          userId: z.string().optional(),
        },
      },
      async ({ fromDate, toDate, userId }) => {
        console.log(":arrow_right: get_user_day_statistics tool invoked");

        try {
          console.log(":arrow_right: Calling getUserDayStatistics()");

          const statistics = await getUserDayStatistics({
            fromDate,
            toDate,
            userId,
          });

          console.log(
            ":white_check_mark: getUserDayStatistics() completed"
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
          console.error(":x: get_user_day_statistics failed:", error);

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
          "Calculates the complete time budget status for a project in Blikk. Returns total budget hours, reported hours, remaining hours, used percentage, remaining percentage and whether the project is over budget. Use this tool for questions about remaining project time, budget usage or budget percentages. Accepts a full or partial project name.",
        inputSchema: {
          project: z.string(),
        },
      },
      async ({ project }) => {
        console.log(
          ":arrow_right: get_project_budget_status tool invoked"
        );

        try {
          console.log(
            ":arrow_right: Calling getProjectBudgetStatus()"
          );

          const budgetStatus =
            await getProjectBudgetStatus(project);

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
        "WWW-Authenticate": 'Bearer realm="operations-agent-mcp"',
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
