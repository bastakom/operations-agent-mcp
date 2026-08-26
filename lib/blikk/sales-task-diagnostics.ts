import {
  getAllTaskBoards,
  getAllTasks,
  type BlikkRawItem,
} from "./endpoints";

type NameId = {
  id: string | null;
  name: string | null;
};

type SafeTag = NameId & {
  color: string | null;
};

export type SafeSalesTaskBoard = {
  id: string;
  name: string;
  project: NameId | null;
  columns: Array<{
    id: string | null;
    name: string | null;
    taskCount: number;
  }>;
  tags: SafeTag[];
  members: NameId[];
  createdDate: string | null;
  updatedDate: string | null;
};

export type SafeSalesTask = {
  id: string;
  title: string;
  description: string | null;
  completedDate: string | null;
  archivedDate: string | null;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  members: Array<{
    id: string | null;
    name: string | null;
  }>;
  tags: SafeTag[];
  board: NameId | null;
  boardColumn: NameId | null;
  project: NameId | null;
  opportunity: NameId | null;
  createdDate: string | null;
  updatedDate: string | null;
  isOpen: boolean;
  hasDate: boolean;
  meetingSignal: boolean;
};

function record(
  value: unknown
): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const result = String(value).trim();
  return result || null;
}

function numberValue(value: unknown) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function nameId(value: unknown): NameId | null {
  const item = record(value);
  if (!item) return null;

  const id = text(item.id ?? item.userId);
  const name = text(
    item.name ?? item.title ?? item.userName
  );

  return id || name ? { id, name } : null;
}

function tag(value: unknown): SafeTag | null {
  const item = record(value);
  const normalized = nameId(value);

  return item && normalized
    ? {
        ...normalized,
        color: text(item.color),
      }
    : null;
}

function dateOnly(value: unknown) {
  const result = text(value)?.slice(0, 10) ?? null;

  return result && /^\d{4}-\d{2}-\d{2}$/.test(result)
    ? result
    : null;
}

function validateDate(
  value: string | undefined,
  fieldName: string
) {
  if (!value) return undefined;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `${fieldName} must use YYYY-MM-DD.`
    );
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);
  const parsed = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(
      `${fieldName} is not a valid calendar date.`
    );
  }

  return value;
}

function toSafeTaskBoard(
  item: BlikkRawItem
): SafeSalesTaskBoard {
  const id = text(item.id);
  const name = text(item.name);

  if (!id || !name) {
    throw new Error(
      "Blikk returned a task board without id or name."
    );
  }

  return {
    id,
    name,
    project: nameId(item.project),
    columns: Array.isArray(item.columns)
      ? item.columns.flatMap((value) => {
          const column = record(value);
          if (!column) return [];

          return [
            {
              id: text(column.id),
              name: text(column.name),
              taskCount: numberValue(
                column.taskCount
              ),
            },
          ];
        })
      : [],
    tags: Array.isArray(item.tags)
      ? item.tags
          .map(tag)
          .filter(
            (value): value is SafeTag =>
              value !== null
          )
      : [],
    members: Array.isArray(item.members)
      ? item.members
          .map(nameId)
          .filter(
            (value): value is NameId =>
              value !== null
          )
      : [],
    createdDate: text(item.createdDate),
    updatedDate: text(item.updatedDate),
  };
}

function hasMeetingSignal(input: {
  title: string;
  description: string | null;
  tags: SafeTag[];
}) {
  const searchable = [
    input.title,
    input.description ?? "",
    ...input.tags.map((item) => item.name ?? ""),
  ]
    .join(" ")
    .toLocaleLowerCase("sv");

  return [
    "möte",
    "meeting",
    "kundmöte",
    "avstämning",
    "uppföljning",
  ].some((term) => searchable.includes(term));
}

function toSafeTask(
  item: BlikkRawItem
): SafeSalesTask {
  const id = text(item.id);
  const title = text(item.title);

  if (!id || !title) {
    throw new Error(
      "Blikk returned a task without id or title."
    );
  }

  const tags = Array.isArray(item.tags)
    ? item.tags
        .map(tag)
        .filter(
          (value): value is SafeTag =>
            value !== null
        )
    : [];
  const completedDate = text(item.completedDate);
  const archivedDate = text(item.archivedDate);
  const startDate = dateOnly(item.startDate);
  const endDate = dateOnly(item.endDate);
  const description = text(item.description);

  return {
    id,
    title,
    description,
    completedDate,
    archivedDate,
    startDate,
    startTime: text(item.startTime),
    endDate,
    endTime: text(item.endTime),
    members: Array.isArray(item.members)
      ? item.members
          .map(nameId)
          .filter(
            (value): value is NameId =>
              value !== null
          )
      : [],
    tags,
    board: nameId(item.board),
    boardColumn: nameId(item.boardColumn),
    project: nameId(item.project),
    opportunity: nameId(item.opportunity),
    createdDate: text(item.createdDate),
    updatedDate: text(item.updatedDate),
    isOpen: !completedDate && !archivedDate,
    hasDate: Boolean(startDate || endDate),
    meetingSignal: hasMeetingSignal({
      title,
      description,
      tags,
    }),
  };
}

export async function getSalesTaskBoardCatalog(
  query?: string
) {
  const normalizedQuery = query?.trim() || undefined;
  const response = await getAllTaskBoards({
    query: normalizedQuery,
    sortBy: "name",
    sortOrder: "ascending",
  });
  const boards = response.items.map(toSafeTaskBoard);

  return {
    generatedAt: new Date().toISOString(),
    query: normalizedQuery ?? null,
    pagesFetched: response.pagesFetched,
    boardCount: boards.length,
    boards,
    warnings: [
      "Read-only task-board catalog. No Blikk data is changed.",
      "A board name alone does not prove that it is the authoritative sales board; verify its columns, tasks and working process.",
    ],
  };
}

async function resolveTaskBoard(
  board: string
) {
  const requested = board.trim();
  if (!requested) {
    throw new Error("A task board is required.");
  }

  const catalog = await getSalesTaskBoardCatalog();
  const requestedLower = requested.toLocaleLowerCase("sv");
  const exact = catalog.boards.find(
    (item) =>
      item.id === requested ||
      item.name.toLocaleLowerCase("sv") ===
        requestedLower
  );
  if (exact) return exact;

  const partial = catalog.boards.filter((item) =>
    item.name
      .toLocaleLowerCase("sv")
      .includes(requestedLower)
  );

  if (partial.length === 1) return partial[0];

  if (partial.length > 1) {
    throw new Error(
      `Multiple task boards match '${requested}': ${partial
        .map((item) => `${item.name} (${item.id})`)
        .join(", ")}.`
    );
  }

  throw new Error(
    `Task board '${requested}' was not found.`
  );
}

export async function inspectSalesTaskBoard(
  options: {
    board: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }
) {
  const fromDate = validateDate(
    options.fromDate,
    "fromDate"
  );
  const toDate = validateDate(
    options.toDate,
    "toDate"
  );

  if (fromDate && toDate && fromDate > toDate) {
    throw new Error(
      "fromDate must be before or equal to toDate."
    );
  }

  const board = await resolveTaskBoard(options.board);
  const response = await getAllTasks({
    taskBoardId: board.id,
    from: fromDate,
    to: toDate,
    sortBy: "startDate",
    sortOrder: "ascending",
  });
  const tasks = response.items.map(toSafeTask);
  const openTasks = tasks.filter((item) => item.isOpen);
  const datedOpenTasks = openTasks.filter(
    (item) => item.hasDate
  );
  const meetingSignals = datedOpenTasks.filter(
    (item) => item.meetingSignal
  );
  const limit = Math.min(
    Math.max(options.limit ?? 100, 1),
    500
  );

  return {
    diagnosticVersion: "sales-task-board-v1",
    generatedAt: new Date().toISOString(),
    board,
    filters: {
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
    },
    totals: {
      tasks: tasks.length,
      openTasks: openTasks.length,
      completedOrArchivedTasks:
        tasks.length - openTasks.length,
      datedOpenTasks: datedOpenTasks.length,
      openTasksWithoutDate:
        openTasks.length - datedOpenTasks.length,
      meetingSignals: meetingSignals.length,
      openTasksWithOpportunity: openTasks.filter(
        (item) => item.opportunity !== null
      ).length,
      openTasksWithProject: openTasks.filter(
        (item) => item.project !== null
      ).length,
      openTasksWithoutMember: openTasks.filter(
        (item) => item.members.length === 0
      ).length,
    },
    nextDatedOpenTasks: datedOpenTasks.slice(0, limit),
    meetingSignals: meetingSignals.slice(0, limit),
    openTasksWithoutDate: openTasks
      .filter((item) => !item.hasDate)
      .slice(0, limit),
    warnings: [
      "Diagnostic read-only output. No Blikk data is changed.",
      "Meeting signals are text matches in task titles, descriptions or tags and are not yet accepted as authoritative booked meetings.",
      "A task can be used as next activity only after BK confirms that the selected board is the maintained sales board.",
      "The Blikk date filters require a task start date and end date respectively; undated tasks can be excluded when a period is supplied.",
    ],
  };
}
