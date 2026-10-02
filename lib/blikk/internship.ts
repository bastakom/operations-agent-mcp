export const DARIIA_SIVIRIN_USER_ID = "15562";
export const DARIIA_SIVIRIN_EMPLOYMENT_START_DATE = "2026-09-10";

export type InternshipTimeClassification =
  | "intern"
  | "employee"
  | "unresolved";

export type InternshipClassification = {
  isInternTime: boolean | null;
  classification: InternshipTimeClassification;
  rule: "dariia_sivirin_cutover_2026_09_10";
  cutoffDate: typeof DARIIA_SIVIRIN_EMPLOYMENT_START_DATE;
};

type GenericRecord = Record<string, unknown>;

function recordValue(value: unknown): GenericRecord | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as GenericRecord)
    : null;
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function hasDateBasedInternshipRule(userId: unknown): boolean {
  return normalizeUserId(userId) === DARIIA_SIVIRIN_USER_ID;
}

export function isInternTag(tag: string): boolean {
  return tag.trim().toLocaleLowerCase("sv-SE") === "praktikant";
}

export function classifyInternshipTime(
  userId: unknown,
  date: unknown
): InternshipClassification | null {
  if (!hasDateBasedInternshipRule(userId)) {
    return null;
  }

  const normalizedDate = dateOnly(date);

  if (!normalizedDate) {
    return {
      isInternTime: null,
      classification: "unresolved",
      rule: "dariia_sivirin_cutover_2026_09_10",
      cutoffDate: DARIIA_SIVIRIN_EMPLOYMENT_START_DATE,
    };
  }

  const isInternTime =
    normalizedDate < DARIIA_SIVIRIN_EMPLOYMENT_START_DATE;

  return {
    isInternTime,
    classification: isInternTime ? "intern" : "employee",
    rule: "dariia_sivirin_cutover_2026_09_10",
    cutoffDate: DARIIA_SIVIRIN_EMPLOYMENT_START_DATE,
  };
}

export function addInternshipClassificationToTimeReports<T>(
  response: T
): T {
  const container = recordValue(response);

  if (!container || !Array.isArray(container.items)) {
    return response;
  }

  return {
    ...container,
    items: container.items.map((item) => {
      const report = recordValue(item);
      const user = recordValue(report?.user);
      const classification = classifyInternshipTime(
        user?.id,
        report?.date
      );

      return report && classification
        ? { ...report, internshipClassification: classification }
        : item;
    }),
  } as T;
}

export function addInternshipClassificationToUserDayStatistics<T>(
  response: T
): T {
  const container = recordValue(response);

  if (!container || !Array.isArray(container.items)) {
    return response;
  }

  return {
    ...container,
    items: container.items.map((item) => {
      const statistic = recordValue(item);

      if (!statistic || !Array.isArray(statistic.dates)) {
        return item;
      }

      return {
        ...statistic,
        dates: statistic.dates.map((dateItem) => {
          const day = recordValue(dateItem);
          const classification = classifyInternshipTime(
            statistic.userId,
            day?.date
          );

          return day && classification
            ? { ...day, internshipClassification: classification }
            : dateItem;
        }),
      };
    }),
  } as T;
}

export function addInternshipClassificationToPlanningItem<T>(
  item: T,
  userId: unknown
): T {
  const planningItem = recordValue(item);
  const classification = classifyInternshipTime(
    userId,
    planningItem?.fromDate
  );

  return planningItem && classification
    ? ({
        ...planningItem,
        internshipClassification: classification,
      } as T)
    : item;
}
