import {
  getProjectTimeCalculation,
  getTimeReports,
} from "./endpoints";
import { resolveProjectId } from "./resolvers";

type ProjectTimeCalculation = {
  objectName?: string;
  total: number;
  isTotal?: boolean;
  isByActivity?: boolean;
  isByActivityAndUser?: boolean;
};

type TimeReport = {
  id: number;
  hours: number;
};

type TimeReportResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: TimeReport[];
};

export type ProjectBudgetStatus = {
  requestedProject: string;
  projectId: string;
  budgetHours: number;
  reportedHours: number;
  remainingHours: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  isOverBudget: boolean;
  overBudgetHours: number;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function getAllProjectTimeReports(
  projectId: string
): Promise<TimeReport[]> {
  const firstPage = (await getTimeReports({
    projectId,
    page: 1,
    pageSize: 100,
  })) as TimeReportResponse;

  const reports: TimeReport[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(300);

    const response = (await getTimeReports({
      projectId,
      page,
      pageSize: 100,
    })) as TimeReportResponse;

    reports.push(...response.items);
  }

  return reports;
}

export async function getProjectBudgetStatus(
  projectName: string
): Promise<ProjectBudgetStatus> {
  const projectId = await resolveProjectId(projectName);

  const calculation = (await getProjectTimeCalculation(
    projectId
  )) as ProjectTimeCalculation;

  if (
    !calculation ||
    typeof calculation.total !== "number"
  ) {
    throw new Error(
      `No valid time calculation was found for project '${projectName}'.`
    );
  }

  const reports = await getAllProjectTimeReports(projectId);

  const budgetHours = calculation.total;

  const reportedHours = reports.reduce(
    (sum, report) => sum + Number(report.hours || 0),
    0
  );

  const remainingHours = budgetHours - reportedHours;
  const isOverBudget = remainingHours < 0;

  const usedPercent =
    budgetHours > 0
      ? (reportedHours / budgetHours) * 100
      : null;

  const remainingPercent =
    budgetHours > 0
      ? (remainingHours / budgetHours) * 100
      : null;

  return {
    requestedProject: projectName,
    projectId,
    budgetHours: round(budgetHours),
    reportedHours: round(reportedHours),
    remainingHours: round(remainingHours),
    usedPercent:
      usedPercent === null ? null : round(usedPercent),
    remainingPercent:
      remainingPercent === null
        ? null
        : round(remainingPercent),
    isOverBudget,
    overBudgetHours: isOverBudget
      ? round(Math.abs(remainingHours))
      : 0,
  };
}
