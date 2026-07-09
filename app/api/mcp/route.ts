import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getBlikkProjects, getBlikkTimeReports, getBlikkUsers } from "../../../lib/blikk/client";
import { asPrettyJson, summarizePagedList } from "../../../lib/blikk/summary";
import { getBlikkAccessToken } from "../../../lib/blikk/auth";

export const runtime = "nodejs";

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    content: [
      {
        type: "text" as const,
        text: `Fel: ${message}`,
      },
    ],
  };
}

const handler = createMcpHandler((server) => {
  server.tool(
    "health_check",
    "Kontrollerar att Operations Agent MCP-servern fungerar.",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: "Operations Agent MCP-servern fungerar.",
          },
        ],
      };
    }
  );

  server.tool(
    "echo",
    "Returnerar samma text som skickas in. Används för test.",
    {
      message: z.string(),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }
  );

  server.tool(
    "blikk_connection_test",
    "Testar att MCP-servern kan autentisera mot Blikk API. Returnerar inte token.",
    {},
    async () => {
      try {
        await getBlikkAccessToken();
        return {
          content: [
            {
              type: "text",
              text: "Kopplingen till Blikk fungerar. Token kunde hämtas.",
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "get_users",
    "Hämtar användare från Blikk. Används för att matcha medarbetare och e-postadresser.",
    {
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(100),
    },
    async ({ page, pageSize }) => {
      try {
        const users = await getBlikkUsers(page, pageSize);
        return {
          content: [
            {
              type: "text",
              text: asPrettyJson(summarizePagedList(users)),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "get_projects",
    "Hämtar projekt från Blikk. Börja med page 1 och pageSize 100.",
    {
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(100),
    },
    async ({ page, pageSize }) => {
      try {
        const projects = await getBlikkProjects(page, pageSize);
        return {
          content: [
            {
              type: "text",
              text: asPrettyJson(summarizePagedList(projects)),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "get_time_reports",
    "Hämtar tidsrapporter från Blikk. Ange datum i formatet YYYY-MM-DD.",
    {
      dateFrom: z.string().describe("Startdatum, format YYYY-MM-DD"),
      dateTo: z.string().describe("Slutdatum, format YYYY-MM-DD"),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(100),
      userId: z.number().int().optional(),
      projectId: z.number().int().optional(),
    },
    async ({ dateFrom, dateTo, page, pageSize, userId, projectId }) => {
      try {
        const reports = await getBlikkTimeReports({
          dateFrom,
          dateTo,
          page,
          pageSize,
          userId,
          projectId,
        });

        return {
          content: [
            {
              type: "text",
              text: asPrettyJson(summarizePagedList(reports)),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    }
  );
});

export { handler as GET, handler as POST, handler as DELETE };
