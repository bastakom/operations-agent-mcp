import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getBlikkAccessToken } from "../../../lib/blikk/auth";
import {
  getProjects,
  getProjectTimeCalculation,
  getTimeReports,
  getUserDayStatistics,
  getUsers,
} from "../../../lib/blikk/endpoints";
import { getPreviousWeekRange } from "../../../lib/tools/dates";

console.log("MCP route loaded");


function asText(data: unknown) {
  return JSON.stringify(data, null, 2);


}

const handler = createMcpHandler((server) => {
  server.tool(
    "health_check",
    "Kontrollerar att Operations Agent MCP-servern fungerar.",
    {},
    async () => ({
      content: [{ type: "text", text: "Operations Agent MCP-servern fungerar." }],
    })
  );

  server.tool(
    "blikk_connection_test",
    "Testar att MCP-servern kan autentisera mot Blikk API.",
    {},
    async () => {
      const token = await getBlikkAccessToken();
      return {
        content: [
          {
            type: "text",
            text: `Blikk-anslutningen fungerar. Token hämtad (${token.length} tecken).`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_users",
    "Hämtar användare från Blikk. Används för att matcha personer och e-postadresser.",
    {},
    async () => ({
      content: [{ type: "text", text: asText(await getUsers()) }],
    })
  );

  server.tool(
    "get_projects",
    "Hämtar projekt från Blikk.",
    {},
    async () => ({
      content: [{ type: "text", text: asText(await getProjects()) }],
    })
  );

  server.tool(
    "get_time_reports",
    "Hämtar tidsrapporter från Blikk. Datumformat: YYYY-MM-DD. Om datum saknas används föregående vecka.",
    {
      fromDate: z.string().optional().describe("Startdatum, t.ex. 2026-07-01"),
      toDate: z.string().optional().describe("Slutdatum, t.ex. 2026-07-07"),
      userId: z.string().optional(),
      projectId: z.string().optional(),
    },
    async ({ fromDate, toDate, userId, projectId }) => {
      const range = fromDate && toDate ? { fromDate, toDate } : getPreviousWeekRange();
      const data = await getTimeReports({ ...range, userId, projectId });
      return {
        content: [{ type: "text", text: asText({ range, data }) }],
      };
    }
  );

  server.tool(
    "get_user_day_statistics",
    "Hämtar dagstatistik per användare från Blikk. Används för att hitta saknad tidsrapportering. Max 31 dagar.",
    {
      fromDate: z.string().optional().describe("Startdatum, t.ex. 2026-07-01"),
      toDate: z.string().optional().describe("Slutdatum, t.ex. 2026-07-07"),
      userId: z.string().optional(),
    },
    async ({ fromDate, toDate, userId }) => {
      const range = fromDate && toDate ? { fromDate, toDate } : getPreviousWeekRange();
      const data = await getUserDayStatistics({ ...range, userId });
      return {
        content: [{ type: "text", text: asText({ range, data }) }],
      };
    }
  );

  server.tool(
    "get_project_time_calculation",
    "Hämtar tidsberäkning/budgetstatus för ett projekt från Blikk.",
    {
      projectId: z.string().describe("Blikk projectId"),
    },
    async ({ projectId }) => ({
      content: [{ type: "text", text: asText(await getProjectTimeCalculation(projectId)) }],
    })
  );
});

export { handler as GET, handler as POST, handler as DELETE };
