import {
  getAllOpportunities,
  getContact,
  getTimeReports,
  type PagedResponse,
} from "./endpoints";
import { toSafeContact, type SafeContact } from "./contacts";
import { toSafeOpportunity } from "./opportunities";
import { getProjectCatalog, type ProjectCatalogItem } from "./resolvers";

const REQUESTS_PER_BATCH = 3;
const BATCH_DELAY_MS = 1100;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapInRateLimitedBatches<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let index = 0; index < items.length; index += REQUESTS_PER_BATCH) {
    if (index > 0) await wait(BATCH_DELAY_MS);
    const batch = items.slice(index, index + REQUESTS_PER_BATCH);
    results.push(...(await Promise.allSettled(batch.map(mapper))));
  }

  return results;
}

function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const result = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function subtractYears(date: Date, years: number): string {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result.toISOString().slice(0, 10);
}

function recommendationScore(input: {
  projects: ProjectCatalogItem[];
  latestEndDate: string;
  openOpportunities: number;
  lostOpportunities: number;
  contact: SafeContact | null;
}) {
  const daysSinceEnd = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${input.latestEndDate}T00:00:00Z`).getTime()) /
        86_400_000
    )
  );
  const recencyPoints = Math.max(0, 20 - Math.floor(daysSinceEnd / 55));

  return Math.min(
    100,
    25 +
      Math.min(30, input.projects.length * 10) +
      recencyPoints +
      (input.openOpportunities === 0 ? 15 : 0) +
      (input.lostOpportunities > 0 ? 5 : 0) +
      (input.contact?.email || input.contact?.phoneNumber || input.contact?.cellPhoneNumber
        ? 5
        : 0)
  );
}

export async function getDormantCustomerOpportunities(years = 3) {
  const generatedAt = new Date();
  const cutoffDate = subtractYears(generatedAt, years);
  const allProjects = await getProjectCatalog();

  const completedInPeriod = allProjects.filter((project) => {
    const endDate = dateOnly(project.endDate);
    return project.isCompleted === true && endDate !== null && endDate >= cutoffDate;
  });

  const reportChecks = await mapInRateLimitedBatches(
    completedInPeriod,
    async (project) => {
      const reports = (await getTimeReports({
        projectId: project.id,
        page: 1,
        pageSize: 1,
      })) as PagedResponse;

      return { projectId: project.id, hasReportedTime: reports.totalItemCount > 0 };
    }
  );

  const projectsWithNoTime: ProjectCatalogItem[] = [];
  const warnings: string[] = [];

  reportChecks.forEach((check, index) => {
    const project = completedInPeriod[index];
    if (check.status === "rejected") {
      warnings.push(
        `Could not verify time reports for '${project.title}' (${project.id}): ${String(
          check.reason
        )}`
      );
    } else if (!check.value.hasReportedTime) {
      projectsWithNoTime.push(project);
    }
  });

  const opportunitiesResponse = await getAllOpportunities({
    sortBy: "updatedDate",
    sortOrder: "descending",
  });
  const opportunities = opportunitiesResponse.items.map(toSafeOpportunity);

  const grouped = new Map<string, ProjectCatalogItem[]>();
  for (const project of projectsWithNoTime) {
    if (!project.customerId || !project.customerName) {
      warnings.push(
        `Project '${project.title}' (${project.id}) has no customer and cannot be recommended.`
      );
      continue;
    }
    const projects = grouped.get(project.customerId) ?? [];
    projects.push(project);
    grouped.set(project.customerId, projects);
  }

  const customers = [...grouped.entries()];
  const contactChecks = await mapInRateLimitedBatches(customers, async ([customerId]) => {
    const contact = await getContact(customerId);
    return { customerId, contact: toSafeContact(contact) };
  });

  const recommendations = customers.map(([customerId, projects], index) => {
    const contactResult = contactChecks[index];
    const contact =
      contactResult.status === "fulfilled" ? contactResult.value.contact : null;

    if (contactResult.status === "rejected") {
      warnings.push(
        `Could not fetch contact details for customer ${customerId}: ${String(
          contactResult.reason
        )}`
      );
    }

    const customerOpportunities = opportunities.filter(
      (opportunity) => opportunity.customer?.id === customerId
    );
    const openOpportunities = customerOpportunities.filter(
      (opportunity) => opportunity.state === "open"
    );
    const lostOpportunities = customerOpportunities.filter(
      (opportunity) => opportunity.state === "lost"
    );
    const latestEndDate = projects
      .map((project) => dateOnly(project.endDate))
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) as string;

    const score = recommendationScore({
      projects,
      latestEndDate,
      openOpportunities: openOpportunities.length,
      lostOpportunities: lostOpportunities.length,
      contact,
    });

    const reasons = [
      `${projects.length} completed project(s) with no reported time`,
      `latest project ended ${latestEndDate}`,
      openOpportunities.length === 0
        ? "no open opportunity exists"
        : `${openOpportunities.length} open opportunity/opportunities already exist`,
      lostOpportunities.length > 0
        ? `${lostOpportunities.length} lost opportunity/opportunities may be worth revisiting`
        : null,
    ].filter((reason): reason is string => reason !== null);

    return {
      rankScore: score,
      customerId,
      customerName: projects[0].customerName,
      contact,
      reasons,
      projects: projects.map((project) => ({
        id: project.id,
        orderNumber: project.orderNumber,
        title: project.title,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        projectManagerName: project.projectManagerName,
      })),
      opportunityHistory: {
        open: openOpportunities,
        won: customerOpportunities.filter((item) => item.state === "won"),
        lost: lostOpportunities,
      },
    };
  });

  recommendations.sort((a, b) => b.rankScore - a.rankScore);

  return {
    generatedAt: generatedAt.toISOString(),
    methodology: {
      years,
      cutoffDate,
      dateBasis: "project.endDate",
      timeBasis: "no time reports found for the project across all dates",
      scoreIsRecommendationNotFact: true,
    },
    counts: {
      allProjects: allProjects.length,
      completedProjectsInPeriod: completedInPeriod.length,
      completedProjectsWithNoTime: projectsWithNoTime.length,
      recommendedCustomers: recommendations.length,
      verificationFailures: reportChecks.filter((item) => item.status === "rejected")
        .length,
    },
    recommendations,
    warnings,
  };
}
