import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  blikkRequest,
  budgetStatus,
  formatJsonForMcp,
  listAllPages,
  pickNestedNumber,
  pickNumber,
  pickString,
  previousWeekRange
} from "../../../lib/blikk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecordLike = Record<string, unknown>;

function projectIdFromTimeReport(report: RecordLike): number | null {
  return pickNumber(report, ["projectId", "ProjectId", "orderId", "OrderId"]) ?? pickNestedNumber(report, [["project", "id"], ["Project", "Id"], ["order", "id"]]);
}

function userIdFromTimeReport(report: RecordLike): number | null {
  return pickNumber(report, ["userId", "UserId", "employeeId", "EmployeeId", "memberId", "MemberId"]) ?? pickNestedNumber(report, [["user", "id"], ["User", "Id"], ["employee", "id"]]);
}

function hoursFromTimeReport(report: RecordLike): number {
  return (
    pickNumber(report, ["hours", "Hours", "quantity", "Quantity", "time", "Time", "reportedHours", "ReportedHours"]) ??
    pickNestedNumber(report, [["time", "hours"], ["Time", "Hours"]]) ??
    0
  );
}

function nameFromUser(user: RecordLike): string {
  return (
    pickString(user, ["name", "Name", "displayName", "DisplayName", "fullName", "FullName"]) ||
    [pickString(user, ["firstName", "FirstName"]), pickString(user, ["lastName", "LastName"])].filter(Boolean).join(" ") ||
    `User ${pickString(user, ["id", "Id"]) || "unknown"}`
  );
}

function emailFromUser(user: RecordLike): string | null {
  return pickString(user, ["email", "Email", "emailAddress", "EmailAddress", "mail", "Mail"]);
}

function projectName(project: RecordLike): string {
  return pickString(project, ["name", "Name", "title", "Title", "projectName", "ProjectName", "orderName", "OrderName"]) || `Project ${pickString(project, ["id", "Id"]) || "unknown"}`;
}

function projectId(project: RecordLike): number | null {
  return pickNumber(project, ["id", "Id", "projectId", "ProjectId"]);
}

async function getTimeReportsRaw(startDate: string, endDate: string, maxPages = 20) {
  return listAllPages<RecordLike>("/v1/Core/TimeReports", {
    "filter.dateFrom": startDate,
    "filter.dateTo": endDate,
    pageSize: 100
  }, maxPages);
}

async function getUsersRaw(includeRestricted = false, maxPages = 20) {
  return listAllPages<RecordLike>("/v1/Admin/Users", {
    "filter.includeRestricted": includeRestricted,
    pageSize: 100
  }, maxPages);
}

async function getProjectsRaw(maxPages = 20) {
  return listAllPages<RecordLike>("/v1/Core/Projects", { pageSize: 100 }, maxPages);
}

async function getProjectTimeCalculation(projectId: number) {
  return blikkRequest<RecordLike>(`/v1/Core/Projects/${projectId}/TimeCalculation`);
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "health_check",
      {
        title: "Health check",
        description: "Kontrollerar att MCP-servern är live.",
        inputSchema: {}
      },
      async () =>
        formatJsonForMcp({
          ok: true,
          service: "Operations Agent MCP",
          timestamp: new Date().toISOString(),
          endpoint: "/api/mcp"
        })
    );

    server.registerTool(
      "blikk_connection_test",
      {
        title: "Testa Blikk-koppling",
        description: "Testar att Blikk App ID och secret fungerar genom att hämta en liten användarlista.",
        inputSchema: {}
      },
      async () => {
        const users = await listAllPages<RecordLike>("/v1/Admin/Users", { pageSize: 5 }, 1);
        return formatJsonForMcp({
          ok: true,
          message: "Blikk-kopplingen fungerar.",
          sampleUserCount: users.length,
          sampleUsers: users.map((user) => ({ id: pickNumber(user, ["id", "Id"]), name: nameFromUser(user), email: emailFromUser(user) }))
        });
      }
    );

    server.registerTool(
      "get_users",
      {
        title: "Hämta användare",
        description: "Hämtar användare från Blikk. Används för att matcha tidsrapporter mot personer och e-postadresser.",
        inputSchema: {
          include_restricted: z.boolean().optional().describe("Sätt till true om även begränsade/restricted users ska inkluderas."),
          max_pages: z.number().int().min(1).max(50).optional().describe("Max antal sidor att hämta. Standard 20.")
        }
      },
      async ({ include_restricted, max_pages }) => {
        const users = await getUsersRaw(include_restricted ?? false, max_pages ?? 20);
        return formatJsonForMcp({
          count: users.length,
          users: users.map((user) => ({
            id: pickNumber(user, ["id", "Id"]),
            name: nameFromUser(user),
            email: emailFromUser(user),
            raw: user
          }))
        });
      }
    );

    server.registerTool(
      "get_projects",
      {
        title: "Hämta projekt",
        description: "Hämtar projekt från Blikk.",
        inputSchema: {
          max_pages: z.number().int().min(1).max(50).optional().describe("Max antal sidor att hämta. Standard 20.")
        }
      },
      async ({ max_pages }) => {
        const projects = await getProjectsRaw(max_pages ?? 20);
        return formatJsonForMcp({
          count: projects.length,
          projects: projects.map((project) => ({
            id: projectId(project),
            name: projectName(project),
            raw: project
          }))
        });
      }
    );

    server.registerTool(
      "get_time_reports",
      {
        title: "Hämta tidsrapporter",
        description: "Hämtar tidsrapporter från Blikk för en period och summerar per person och projekt.",
        inputSchema: {
          start_date: z.string().describe("Startdatum i format YYYY-MM-DD."),
          end_date: z.string().describe("Slutdatum i format YYYY-MM-DD."),
          max_pages: z.number().int().min(1).max(50).optional().describe("Max antal sidor att hämta. Standard 20.")
        }
      },
      async ({ start_date, end_date, max_pages }) => {
        const reports = await getTimeReportsRaw(start_date, end_date, max_pages ?? 20);

        const byUser = new Map<number, number>();
        const byProject = new Map<number, number>();
        let totalHours = 0;

        for (const report of reports) {
          const hours = hoursFromTimeReport(report);
          totalHours += hours;
          const userId = userIdFromTimeReport(report);
          const projectId = projectIdFromTimeReport(report);
          if (userId !== null) byUser.set(userId, (byUser.get(userId) ?? 0) + hours);
          if (projectId !== null) byProject.set(projectId, (byProject.get(projectId) ?? 0) + hours);
        }

        return formatJsonForMcp({
          period: { start_date, end_date },
          count: reports.length,
          totalHours,
          hoursByUser: Array.from(byUser.entries()).map(([userId, hours]) => ({ userId, hours })),
          hoursByProject: Array.from(byProject.entries()).map(([projectId, hours]) => ({ projectId, hours })),
          rawReports: reports
        });
      }
    );

    server.registerTool(
      "get_missing_time_reports",
      {
        title: "Hitta saknad tidsrapportering",
        description: "Kontrollerar saknad eller bristfällig tidsrapportering via Blikks UserDayStatistics-endpoint. Perioden får vara max 31 dagar.",
        inputSchema: {
          start_date: z.string().describe("Startdatum i format YYYY-MM-DD."),
          end_date: z.string().describe("Slutdatum i format YYYY-MM-DD."),
          user_id: z.number().int().optional().describe("Valfritt Blikk user id om bara en person ska kontrolleras.")
        }
      },
      async ({ start_date, end_date, user_id }) => {
        const params: Record<string, string | number | boolean | null | undefined> = {
          "filter.dateFrom": start_date,
          "filter.dateTo": end_date
        };
        if (user_id) params["filter.userId"] = user_id;

        const stats = await blikkRequest<unknown>("/v1/Core/TimeReports/UserDayStatistics", params);
        return formatJsonForMcp({
          period: { start_date, end_date },
          note: "Blikks råsvar returneras eftersom fältnamn kan variera mellan konton. Agenten ska tolka dagar/användare med saknad eller ofullständig tid.",
          raw: stats
        });
      }
    );

    server.registerTool(
      "get_project_budget_status",
      {
        title: "Projektbudgetstatus",
        description: "Hämtar TimeCalculation för ett projekt och räknar grön/gul/röd om budgettimmar kan hittas.",
        inputSchema: {
          project_id: z.number().int().describe("Blikk project id."),
          reported_hours_override: z.number().optional().describe("Valfritt: rapporterade timmar att jämföra mot budget om TimeCalculation saknar rapporterad tid.")
        }
      },
      async ({ project_id, reported_hours_override }) => {
        const calc = await getProjectTimeCalculation(project_id);
        const budgetHours = pickNumber(calc, ["budgetHours", "BudgetHours", "timeBudget", "TimeBudget", "budgetedHours", "BudgetedHours"])
          ?? pickNestedNumber(calc, [["budget", "hours"], ["Budget", "Hours"], ["timeBudget", "hours"]]);
        const reportedHours = reported_hours_override
          ?? pickNumber(calc, ["reportedHours", "ReportedHours", "usedHours", "UsedHours", "totalHours", "TotalHours", "actualHours", "ActualHours"])
          ?? pickNestedNumber(calc, [["reported", "hours"], ["actual", "hours"], ["time", "reportedHours"]])
          ?? 0;
        const usedPercent = budgetHours && budgetHours > 0 ? Math.round((reportedHours / budgetHours) * 1000) / 10 : null;

        return formatJsonForMcp({
          projectId: project_id,
          budgetHours,
          reportedHours,
          usedPercent,
          status: budgetStatus(reportedHours, budgetHours),
          raw: calc
        });
      }
    );

    server.registerTool(
      "get_resource_planning",
      {
        title: "Hämta resursplanering",
        description: "Hämtar planeringssummeringar från Blikk. Kan användas per projekt eller per användare.",
        inputSchema: {
          start_date: z.string().describe("Startdatum i format YYYY-MM-DD."),
          end_date: z.string().describe("Slutdatum i format YYYY-MM-DD."),
          project_id: z.number().int().optional().describe("Om satt hämtas planeringssummering för användare på projekt."),
          user_id: z.number().int().optional().describe("Om satt hämtas planeringssummering för projekt på användare.")
        }
      },
      async ({ start_date, end_date, project_id, user_id }) => {
        if (!project_id && !user_id) {
          return formatJsonForMcp({ error: "Ange antingen project_id eller user_id." });
        }

        const params: Record<string, string | number> = {
          "filter.dateFrom": start_date,
          "filter.dateTo": end_date
        };

        let path = "";
        if (project_id) {
          path = "/v1/Core/Planning/GetPlanningSummaries/Users";
          params["filter.projectId"] = project_id;
        } else if (user_id) {
          path = "/v1/Core/Planning/GetPlanningSummaries/Projects";
          params["filter.userId"] = user_id;
        }

        const planning = await blikkRequest<unknown>(path, params);
        return formatJsonForMcp({ period: { start_date, end_date }, project_id, user_id, raw: planning });
      }
    );

    server.registerTool(
      "get_weekly_operations_report",
      {
        title: "Skapa veckorapportdata",
        description: "Hämtar tidsrapporter, användare, projekt och budgetstatus för föregående vecka eller vald period. Returnerar strukturerad data som agenten kan skriva rapport från.",
        inputSchema: {
          start_date: z.string().optional().describe("Valfritt startdatum YYYY-MM-DD. Om tomt används föregående vecka."),
          end_date: z.string().optional().describe("Valfritt slutdatum YYYY-MM-DD. Om tomt används föregående vecka."),
          max_pages: z.number().int().min(1).max(50).optional().describe("Max antal sidor per list-endpoint. Standard 20."),
          include_raw: z.boolean().optional().describe("Sätt true om rådata ska returneras för felsökning.")
        }
      },
      async ({ start_date, end_date, max_pages, include_raw }) => {
        const range = start_date && end_date ? { startDate: start_date, endDate: end_date } : previousWeekRange();
        const [reports, users, projects] = await Promise.all([
          getTimeReportsRaw(range.startDate, range.endDate, max_pages ?? 20),
          getUsersRaw(false, max_pages ?? 20),
          getProjectsRaw(max_pages ?? 20)
        ]);

        const userLookup = new Map<number, RecordLike>();
        for (const user of users) {
          const id = pickNumber(user, ["id", "Id"]);
          if (id !== null) userLookup.set(id, user);
        }

        const projectLookup = new Map<number, RecordLike>();
        for (const project of projects) {
          const id = projectId(project);
          if (id !== null) projectLookup.set(id, project);
        }

        const hoursByUser = new Map<number, number>();
        const hoursByProject = new Map<number, number>();
        let totalHours = 0;

        for (const report of reports) {
          const hours = hoursFromTimeReport(report);
          totalHours += hours;
          const uid = userIdFromTimeReport(report);
          const pid = projectIdFromTimeReport(report);
          if (uid !== null) hoursByUser.set(uid, (hoursByUser.get(uid) ?? 0) + hours);
          if (pid !== null) hoursByProject.set(pid, (hoursByProject.get(pid) ?? 0) + hours);
        }

        const projectStatuses = [] as Array<Record<string, unknown>>;
        const projectEntries = Array.from(hoursByProject.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25);
        for (const [pid, hours] of projectEntries) {
          try {
            const calc = await getProjectTimeCalculation(pid);
            const budgetHours = pickNumber(calc, ["budgetHours", "BudgetHours", "timeBudget", "TimeBudget", "budgetedHours", "BudgetedHours"])
              ?? pickNestedNumber(calc, [["budget", "hours"], ["Budget", "Hours"], ["timeBudget", "hours"]]);
            const usedPercent = budgetHours && budgetHours > 0 ? Math.round((hours / budgetHours) * 1000) / 10 : null;
            projectStatuses.push({
              projectId: pid,
              projectName: projectLookup.has(pid) ? projectName(projectLookup.get(pid) as RecordLike) : `Project ${pid}`,
              reportedHoursThisPeriod: hours,
              budgetHours,
              usedPercent,
              status: budgetStatus(hours, budgetHours),
              timeCalculationRaw: include_raw ? calc : undefined
            });
          } catch (error) {
            projectStatuses.push({
              projectId: pid,
              projectName: projectLookup.has(pid) ? projectName(projectLookup.get(pid) as RecordLike) : `Project ${pid}`,
              reportedHoursThisPeriod: hours,
              status: "unknown",
              warning: error instanceof Error ? error.message : String(error)
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        let missingTimeRaw: unknown = null;
        try {
          missingTimeRaw = await blikkRequest<unknown>("/v1/Core/TimeReports/UserDayStatistics", {
            "filter.dateFrom": range.startDate,
            "filter.dateTo": range.endDate
          });
        } catch (error) {
          missingTimeRaw = { warning: error instanceof Error ? error.message : String(error) };
        }

        return formatJsonForMcp({
          period: { start_date: range.startDate, end_date: range.endDate },
          summary: {
            timeReportRows: reports.length,
            totalReportedHours: totalHours,
            userCount: users.length,
            projectCount: projects.length
          },
          hoursByUser: Array.from(hoursByUser.entries()).map(([uid, hours]) => {
            const user = userLookup.get(uid);
            return {
              userId: uid,
              name: user ? nameFromUser(user) : `User ${uid}`,
              email: user ? emailFromUser(user) : null,
              hours
            };
          }).sort((a, b) => b.hours - a.hours),
          projectStatuses: projectStatuses.sort((a, b) => Number(b.usedPercent ?? -1) - Number(a.usedPercent ?? -1)),
          missingTimeRaw,
          recommendedAgentInstruction: "Skriv en svensk ledningsrapport med röd/gul/grön status, toppavvikelser, personer som saknar tid och konkreta åtgärder för kommande vecka.",
          raw: include_raw ? { reports, users, projects } : undefined
        });
      }
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
