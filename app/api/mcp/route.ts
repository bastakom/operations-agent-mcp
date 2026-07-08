import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getBlikkAccessToken } from "../../../lib/blikk";
import {
  buildWeeklyOperationsData,
  getPlanningSummariesProjects,
  getPlanningSummariesUsers,
  getProjectTimeCalculation,
  listProjects,
  listTimeReports,
  listUserDayStatistics,
  listUsers
} from "../../../lib/operations";

const dateRangeSchema = {
  from: z.string().optional().describe("Start date in YYYY-MM-DD. Defaults to previous week."),
  to: z.string().optional().describe("End date in YYYY-MM-DD. Defaults to previous week.")
};

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "health_check",
      {
        title: "Health check",
        description: "Check that the MCP server is running and whether Blikk environment variables are configured.",
        inputSchema: {}
      },
      async () => {
        return jsonText({
          ok: true,
          service: "operations-agent-mcp",
          timestamp: new Date().toISOString(),
          blikkConfigured: Boolean(process.env.BLIKK_APP_ID && process.env.BLIKK_APP_SECRET),
          availableTools: [
            "test_blikk_auth",
            "get_users",
            "get_projects",
            "get_time_reports",
            "get_user_day_statistics",
            "get_project_time_calculation",
            "get_planning_summaries_projects",
            "get_planning_summaries_users",
            "get_weekly_operations_data"
          ]
        });
      }
    );

    server.registerTool(
      "test_blikk_auth",
      {
        title: "Test Blikk auth",
        description: "Verify that Blikk App ID and Secret work by fetching an access token. Returns no secret values.",
        inputSchema: {}
      },
      async () => {
        const token = await getBlikkAccessToken();
        return jsonText({ ok: true, tokenPreview: `${token.slice(0, 8)}...`, timestamp: new Date().toISOString() });
      }
    );

    server.registerTool(
      "get_users",
      {
        title: "Get Blikk users",
        description: "Fetch users from Blikk. Useful for matching reported time to people and e-mail addresses.",
        inputSchema: {}
      },
      async () => jsonText(await listUsers())
    );

    server.registerTool(
      "get_projects",
      {
        title: "Get Blikk projects",
        description: "Fetch projects from Blikk.",
        inputSchema: {}
      },
      async () => jsonText(await listProjects())
    );

    server.registerTool(
      "get_time_reports",
      {
        title: "Get time reports",
        description: "Fetch time reports from Blikk for a date range. Defaults to previous week.",
        inputSchema: dateRangeSchema
      },
      async ({ from, to }) => jsonText(await listTimeReports({ from, to }))
    );

    server.registerTool(
      "get_user_day_statistics",
      {
        title: "Get user day statistics",
        description: "Fetch Blikk user day statistics for checking missing or low time reporting. Defaults to previous week.",
        inputSchema: dateRangeSchema
      },
      async ({ from, to }) => jsonText(await listUserDayStatistics({ from, to }))
    );

    server.registerTool(
      "get_project_time_calculation",
      {
        title: "Get project time calculation",
        description: "Fetch Blikk time calculation/budget status for one project.",
        inputSchema: {
          projectId: z.number().int().positive().describe("Blikk project id")
        }
      },
      async ({ projectId }) => jsonText(await getProjectTimeCalculation(projectId))
    );

    server.registerTool(
      "get_planning_summaries_projects",
      {
        title: "Get planning summaries for projects",
        description: "Fetch resource planning summaries by project from Blikk. Defaults to previous week.",
        inputSchema: dateRangeSchema
      },
      async ({ from, to }) => jsonText(await getPlanningSummariesProjects({ from, to }))
    );

    server.registerTool(
      "get_planning_summaries_users",
      {
        title: "Get planning summaries for users",
        description: "Fetch resource planning summaries by user from Blikk. Defaults to previous week.",
        inputSchema: dateRangeSchema
      },
      async ({ from, to }) => jsonText(await getPlanningSummariesUsers({ from, to }))
    );

    server.registerTool(
      "get_weekly_operations_data",
      {
        title: "Get weekly operations data",
        description: "Fetch and prepare the core weekly data for the Operations Agent: reported time, missing/low reporting, project totals and budget status. Defaults to previous week.",
        inputSchema: dateRangeSchema
      },
      async ({ from, to }) => jsonText(await buildWeeklyOperationsData({ from, to }))
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true
  }
);

export { handler as GET, handler as POST };
