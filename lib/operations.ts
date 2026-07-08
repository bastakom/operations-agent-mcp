import { blikkRequest, buildQuery, getPagedList } from "./blikk";
import { validateDateRange } from "./dates";

export type DateRangeInput = { from?: string; to?: string };

function readNumber(...values: any[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickName(entity: any) {
  return entity?.name || entity?.title || entity?.displayName || entity?.fullName || entity?.projectName || "Okänt";
}

function pickId(entity: any) {
  return entity?.id ?? entity?.projectId ?? entity?.userId ?? entity?.guid ?? null;
}

export async function listUsers() {
  return getPagedList("/v1/Admin/Users", { pageSize: 100 }, 20);
}

export async function listProjects() {
  return getPagedList("/v1/Core/Projects", { pageSize: 100 }, 30);
}

export async function listTimeReports(input: DateRangeInput = {}) {
  const { from, to } = validateDateRange(input.from, input.to);
  const items = await getPagedList("/v1/Core/TimeReports", {
    pageSize: 100,
    "filter.from": from,
    "filter.to": to,
    sortOrder: "ascending"
  }, 30);
  return { from, to, items };
}

export async function listUserDayStatistics(input: DateRangeInput = {}) {
  const { from, to } = validateDateRange(input.from, input.to);
  const items = await getPagedList("/v1/Core/TimeReports/UserDayStatistics", {
    pageSize: 100,
    "filter.from": from,
    "filter.to": to,
    sortOrder: "ascending"
  }, 30);
  return { from, to, items };
}

export async function getProjectTimeCalculation(projectId: number) {
  return blikkRequest(`/v1/Core/Projects/${projectId}/TimeCalculation`);
}

export async function getPlanningSummariesProjects(input: DateRangeInput = {}) {
  const { from, to } = validateDateRange(input.from, input.to);
  const query = buildQuery({ fromDate: from, toDate: to, page: 1, pageSize: 100 });
  const data = await blikkRequest(`/v1/Core/Planning/GetPlanningSummaries/Projects${query}`);
  return { from, to, data };
}

export async function getPlanningSummariesUsers(input: DateRangeInput = {}) {
  const { from, to } = validateDateRange(input.from, input.to);
  const query = buildQuery({ fromDate: from, toDate: to, page: 1, pageSize: 100 });
  const data = await blikkRequest(`/v1/Core/Planning/GetPlanningSummaries/Users${query}`);
  return { from, to, data };
}

export async function buildWeeklyOperationsData(input: DateRangeInput = {}) {
  const { from, to } = validateDateRange(input.from, input.to);
  const [timeReportsResult, userStatsResult, projects, users] = await Promise.all([
    listTimeReports({ from, to }),
    listUserDayStatistics({ from, to }),
    listProjects(),
    listUsers()
  ]);

  const timeReports: any[] = timeReportsResult.items || [];
  const userStats: any[] = userStatsResult.items || [];
  const projectMap = new Map(projects.map((p: any) => [String(pickId(p)), p]));
  const userMap = new Map(users.map((u: any) => [String(pickId(u)), u]));

  const projectTotals = new Map<string, any>();
  const userTotals = new Map<string, any>();

  for (const report of timeReports) {
    const projectId = String(report.projectId ?? report.project?.id ?? report.project?.projectId ?? "unknown");
    const userId = String(report.userId ?? report.user?.id ?? report.createdByUserId ?? "unknown");
    const hours = readNumber(report.hours, report.quantity, report.time, report.reportedHours, report.amount);

    const project = projectMap.get(projectId);
    const user = userMap.get(userId);

    const p = projectTotals.get(projectId) || {
      projectId,
      projectName: project ? pickName(project) : report.projectName || report.project?.name || "Okänt projekt",
      reportedHours: 0,
      reportCount: 0
    };
    p.reportedHours += hours;
    p.reportCount += 1;
    projectTotals.set(projectId, p);

    const u = userTotals.get(userId) || {
      userId,
      userName: user ? pickName(user) : report.userName || report.user?.name || "Okänd användare",
      email: user?.email || report.user?.email || null,
      reportedHours: 0,
      reportCount: 0
    };
    u.reportedHours += hours;
    u.reportCount += 1;
    userTotals.set(userId, u);
  }

  const missingOrLowReporting = userStats
    .filter((s: any) => {
      const reported = readNumber(s.reportedHours, s.hours, s.totalHours, s.reportedTime, s.time);
      const expected = readNumber(s.expectedHours, s.plannedHours, s.normalHours, s.workHours);
      return expected > 0 && reported < expected;
    })
    .map((s: any) => ({
      userId: s.userId ?? s.user?.id ?? null,
      userName: s.userName || s.user?.name || "Okänd användare",
      email: s.email || s.user?.email || null,
      date: s.date || s.day || null,
      reportedHours: readNumber(s.reportedHours, s.hours, s.totalHours, s.reportedTime, s.time),
      expectedHours: readNumber(s.expectedHours, s.plannedHours, s.normalHours, s.workHours),
      raw: s
    }));

  const budgetStatus: any[] = [];
  const topProjects = Array.from(projectTotals.values())
    .filter((p) => p.projectId !== "unknown")
    .sort((a, b) => b.reportedHours - a.reportedHours)
    .slice(0, 15);

  for (const project of topProjects) {
    const numericProjectId = Number(project.projectId);
    if (!Number.isFinite(numericProjectId)) continue;
    try {
      const calculation: any = await getProjectTimeCalculation(numericProjectId);
      const budgetHours = readNumber(calculation.budgetHours, calculation.budgetedHours, calculation.totalBudgetHours, calculation.totalHours, calculation.budget);
      const usedHours = readNumber(calculation.usedHours, calculation.reportedHours, calculation.totalReportedHours, project.reportedHours);
      const percentUsed = budgetHours > 0 ? Math.round((usedHours / budgetHours) * 100) : null;
      const status = percentUsed === null ? "okänd" : percentUsed >= 100 ? "röd" : percentUsed >= 80 ? "gul" : "grön";
      budgetStatus.push({
        projectId: project.projectId,
        projectName: project.projectName,
        reportedHoursThisPeriod: Math.round(project.reportedHours * 100) / 100,
        budgetHours,
        usedHours,
        percentUsed,
        status,
        rawCalculation: calculation
      });
    } catch (error: any) {
      budgetStatus.push({
        projectId: project.projectId,
        projectName: project.projectName,
        reportedHoursThisPeriod: Math.round(project.reportedHours * 100) / 100,
        status: "kunde inte hämta budget",
        error: error.message
      });
    }
  }

  return {
    period: { from, to },
    summary: {
      timeReportCount: timeReports.length,
      projectCountWithReportedTime: projectTotals.size,
      userCountWithReportedTime: userTotals.size,
      missingOrLowReportingCount: missingOrLowReporting.length
    },
    projectTotals: Array.from(projectTotals.values()).sort((a, b) => b.reportedHours - a.reportedHours),
    userTotals: Array.from(userTotals.values()).sort((a, b) => b.reportedHours - a.reportedHours),
    missingOrLowReporting,
    budgetStatus,
    recommendationHint: "Använd datan för att skriva kort ledningsrapport, risklista och mailutkast på svenska. Kontrollera manuellt i Blikk första veckorna innan automatiska utskick."
  };
}
