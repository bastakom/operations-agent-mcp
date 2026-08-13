import {
  getAllOpportunities,
  type OpportunityParams,
} from "./endpoints";

type NameId = {
  id: string | null;
  name: string | null;
};

type SafeOpportunity = {
  id: string;
  title: string;
  turnover: number | null;
  probability: number | null;
  description: string | null;
  hasOffers: boolean;
  responsible: NameId | null;
  customer: NameId | null;
  contact: NameId | null;
  state: string | null;
  closedDate: string | null;
  estimatedClosingDate: string | null;
  status: NameId | null;
  project: NameId | null;
  tags: Array<NameId & { color: string | null }>;
  createdDate: string | null;
  updatedDate: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const result = String(value).trim();
  return result || null;
}

function nameId(value: unknown): NameId | null {
  const item = record(value);
  if (!item) return null;

  const name = text(item.name ?? item.title);
  const id = text(item.id);
  return name || id ? { id, name } : null;
}

export function toSafeOpportunity(item: Record<string, unknown>): SafeOpportunity {
  const id = text(item.id);
  if (!id) {
    throw new Error("Blikk returned an opportunity without an id.");
  }

  return {
    id,
    title: text(item.title) ?? "Untitled opportunity",
    turnover: typeof item.turnover === "number" ? item.turnover : null,
    probability:
      typeof item.probability === "number" ? item.probability : null,
    description: text(item.description),
    hasOffers: item.hasOffers === true,
    responsible: nameId(item.user),
    customer: nameId(item.customer),
    contact: nameId(item.contact),
    state: text(item.opportunityState)?.toLowerCase() ?? null,
    closedDate: text(item.closedDate),
    estimatedClosingDate: text(item.estimatedClosingDate),
    status: nameId(item.status),
    project: nameId(item.project),
    tags: Array.isArray(item.tags)
      ? item.tags.flatMap((value) => {
          const tag = record(value);
          if (!tag) return [];
          const normalized = nameId(tag);
          return normalized
            ? [{ ...normalized, color: text(tag.color) }]
            : [];
        })
      : [],
    createdDate: text(item.createdDate),
    updatedDate: text(item.updatedDate),
  };
}

function groupTurnover(
  opportunities: SafeOpportunity[],
  key: (item: SafeOpportunity) => string
) {
  const groups = new Map<string, { count: number; turnover: number }>();

  for (const opportunity of opportunities) {
    const name = key(opportunity);
    const current = groups.get(name) ?? { count: 0, turnover: 0 };
    current.count += 1;
    current.turnover += opportunity.turnover ?? 0;
    groups.set(name, current);
  }

  return [...groups.entries()]
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.turnover - a.turnover);
}

export async function getOpportunityPipeline(
  params: Omit<OpportunityParams, "page" | "pageSize">
) {
  const response = await getAllOpportunities(params);
  const opportunities = response.items.map(toSafeOpportunity);
  const today = new Date().toISOString().slice(0, 10);
  const open = opportunities.filter((item) => item.state === "open");

  return {
    generatedAt: new Date().toISOString(),
    filters: params,
    totals: {
      opportunities: opportunities.length,
      turnover: opportunities.reduce(
        (sum, item) => sum + (item.turnover ?? 0),
        0
      ),
      open: open.length,
      won: opportunities.filter((item) => item.state === "won").length,
      lost: opportunities.filter((item) => item.state === "lost").length,
      withOffers: opportunities.filter((item) => item.hasOffers).length,
      overdueOpen: open.filter(
        (item) =>
          item.estimatedClosingDate !== null &&
          item.estimatedClosingDate.slice(0, 10) < today
      ).length,
    },
    byState: groupTurnover(
      opportunities,
      (item) => item.state ?? "unknown"
    ),
    byStatus: groupTurnover(
      opportunities,
      (item) => item.status?.name ?? "unknown"
    ),
    byResponsible: groupTurnover(
      opportunities,
      (item) => item.responsible?.name ?? "unknown"
    ),
    opportunities,
  };
}
