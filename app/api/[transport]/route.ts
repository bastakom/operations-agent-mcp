import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getUsers,
  getProjects,
  getTimeReports,
  getUserDayStatistics,
  getProjectTimeCalculation,
} from "../../../lib/blikk/endpoints";

const handler = createMcpHandler(
  (server) => {
    console.log("🚀 MCP server initialized");

    server.registerTool(
      "health_check",
      {
        title: "Health Check",
        description: "Checks that the MCP server is alive and well.",
        inputSchema: {},
      },
      async () => {
        console.log("✅ health_check called");

        return {
          content: [
            {
              type: "text",
              text: "MCP server is alive 🚀",
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
        console.log("➡️ get_users tool invoked");

        try {
          console.log("➡️ Calling getUsers()");

          const users = await getUsers();

          console.log("✅ getUsers() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(users, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("❌ get_users failed:", error);

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
        description: "Fetches all projects from Blikk.",
        inputSchema: {},
      },
      async () => {
        console.log("➡️ get_projects tool invoked");

        try {
          console.log("➡️ Calling getProjects()");

          const projects = await getProjects();

          console.log("✅ getProjects() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(projects, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("❌ get_projects failed:", error);

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
        console.log("➡️ get_time_reports tool invoked");

        try {
          console.log("➡️ Calling getTimeReports()");

          const reports = await getTimeReports({
            fromDate,
            toDate,
            userId,
            projectId,
          });

          console.log("✅ getTimeReports() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(reports, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("❌ get_time_reports failed:", error);

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
        console.log("➡️ get_user_day_statistics tool invoked");

        try {
          console.log("➡️ Calling getUserDayStatistics()");

          const statistics = await getUserDayStatistics({
            fromDate,
            toDate,
            userId,
          });

          console.log("✅ getUserDayStatistics() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(statistics, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("❌ get_user_day_statistics failed:", error);

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
          "Fetches time calculation, budget usage and remaining time for a specific project in Blikk.",
        inputSchema: {
          projectId: z.string(),
        },
      },
      async ({ projectId }) => {
        console.log("➡️ get_project_time_calculation tool invoked");

        try {
          console.log("➡️ Calling getProjectTimeCalculation()");

          const calculation = await getProjectTimeCalculation(projectId);

          console.log("✅ getProjectTimeCalculation() completed");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(calculation, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("❌ get_project_time_calculation failed:", error);

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
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
