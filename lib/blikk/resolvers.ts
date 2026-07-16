import {
  getProjects,
  getUsers,
  getUsersWithResourcePlanning,
} from "./endpoints";

type BlikkProjectStatus = {
  name: string;
  isCompletedStatus: boolean;
};

type BlikkProjectCustomer = {
  id: number | string;
  name: string;
};

type BlikkProjectManager = {
  id: number | string;
  name: string;
};

type BlikkProjectMetadata =
  | string
  | {
      id?: number | string | null;
      name?: string | null;
      title?: string | null;
      color?: string | null;
    };

type BlikkProjectApiItem = {
  id: number | string;
  orderNumber?: string | null;
  title: string;
  status?: BlikkProjectStatus | null;
  customer?: BlikkProjectCustomer | null;
  projectManager?: BlikkProjectManager | null;
  startDate?: string | null;
  endDate?: string | null;
  category?: BlikkProjectMetadata | null;
  tags?: BlikkProjectMetadata[] | null;
  projectCollection?: BlikkProjectMetadata | null;
  costCenter?: BlikkProjectMetadata | null;
};

type BlikkProjectResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: BlikkProjectApiItem[];
};

type BlikkUser = {
  id: number | string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  name?: string | null;
};

type BlikkUserResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: BlikkUser[];
};

type BlikkPlanningUser = {
  id: number | string;
  employmentNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type BlikkPlanningUserResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: BlikkPlanningUser[];
};

export type ProjectMetadataItem = {
  id: string | null;
  name: string;
  color: string | null;
};

export type ProjectCatalogItem = {
  id: string;
  orderNumber: string | null;
  title: string;
  status: string | null;
  isCompleted: boolean | null;
  customerId: string | null;
  customerName: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  startDate: string | null;
  endDate: string | null;
  category: ProjectMetadataItem | null;
  tags: ProjectMetadataItem[];
  projectCollection: ProjectMetadataItem | null;
  costCenter: ProjectMetadataItem | null;
};

type ProjectCache = {
  projects: ProjectCatalogItem[];
  expiresAt: number;
};

type UserCache = {
  users: BlikkUser[];
  expiresAt: number;
};

const PROJECT_CACHE_TTL_MS = 10 * 60 * 1000;
const USER_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_DELAY_MS = 1100;

let projectCache: ProjectCache | null = null;
let projectLoadPromise: Promise<ProjectCatalogItem[]> | null = null;

let userCache: UserCache | null = null;
let userLoadPromise: Promise<BlikkUser[]> | null = null;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getUserFullName(user: BlikkUser): string {
  return (
    user.fullName ??
    user.name ??
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
  ).trim();
}

function getPlanningUserFullName(
  user: BlikkPlanningUser
): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

function toMetadataItem(
  value: BlikkProjectMetadata | null | undefined
): ProjectMetadataItem | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const name = value.trim();

    return name
      ? {
          id: null,
          name,
          color: null,
        }
      : null;
  }

  const name = (value.name ?? value.title ?? "").trim();

  if (!name) {
    return null;
  }

  return {
    id:
      value.id !== undefined && value.id !== null
        ? String(value.id)
        : null,
    name,
    color: value.color ?? null,
  };
}

function toCatalogItem(
  project: BlikkProjectApiItem
): ProjectCatalogItem {
  return {
    id: String(project.id),
    orderNumber: project.orderNumber ?? null,
    title: project.title.trim(),
    status: project.status?.name ?? null,
    isCompleted:
      typeof project.status?.isCompletedStatus === "boolean"
        ? project.status.isCompletedStatus
        : null,
    customerId:
      project.customer?.id !== undefined
        ? String(project.customer.id)
        : null,
    customerName: project.customer?.name ?? null,
    projectManagerId:
      project.projectManager?.id !== undefined
        ? String(project.projectManager.id)
        : null,
    projectManagerName: project.projectManager?.name ?? null,
    startDate: project.startDate ?? null,
    endDate: project.endDate ?? null,
    category: toMetadataItem(project.category),
    tags: (project.tags ?? [])
      .map(toMetadataItem)
      .filter(
        (tag): tag is ProjectMetadataItem => tag !== null
      ),
    projectCollection: toMetadataItem(
      project.projectCollection
    ),
    costCenter: toMetadataItem(project.costCenter),
  };
}

async function fetchAllProjects(): Promise<ProjectCatalogItem[]> {
  console.log("📥 Fetching all projects from Blikk");

  const firstPage = (await getProjects({
    page: 1,
    pageSize: 100,
  })) as BlikkProjectResponse;

  if (!firstPage || !Array.isArray(firstPage.items)) {
    throw new Error(
      "Blikk returned an unexpected response when fetching projects."
    );
  }

  const projects: ProjectCatalogItem[] =
    firstPage.items.map(toCatalogItem);

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(REQUEST_DELAY_MS);

    const response = (await getProjects({
      page,
      pageSize: 100,
    })) as BlikkProjectResponse;

    if (!response || !Array.isArray(response.items)) {
      throw new Error(
        `Blikk returned an unexpected response when fetching projects on page ${page}.`
      );
    }

    projects.push(...response.items.map(toCatalogItem));
  }

  console.log(`✅ Fetched ${projects.length} projects from Blikk`);

  return projects;
}

async function getCachedProjects(): Promise<ProjectCatalogItem[]> {
  const now = Date.now();

  if (projectCache && projectCache.expiresAt > now) {
    console.log("⚡ Using cached project list");
    return projectCache.projects;
  }

  if (projectLoadPromise) {
    console.log("⏳ Waiting for ongoing project list fetch");
    return projectLoadPromise;
  }

  console.log("♻️ Project cache is empty or expired");

  const loadPromise = fetchAllProjects();
  projectLoadPromise = loadPromise;

  try {
    const projects = await loadPromise;

    projectCache = {
      projects,
      expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
    };

    console.log("✅ Project cache updated");

    return projects;
  } finally {
    if (projectLoadPromise === loadPromise) {
      projectLoadPromise = null;
    }
  }
}

async function fetchAllUsers(): Promise<BlikkUser[]> {
  console.log("📥 Fetching all users from Blikk");

  const firstPage = (await getUsers({
    page: 1,
    pageSize: 100,
  })) as BlikkUserResponse;

  if (!firstPage || !Array.isArray(firstPage.items)) {
    throw new Error(
      "Blikk returned an unexpected response when fetching users."
    );
  }

  const users: BlikkUser[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(REQUEST_DELAY_MS);

    const response = (await getUsers({
      page,
      pageSize: 100,
    })) as BlikkUserResponse;

    if (!response || !Array.isArray(response.items)) {
      throw new Error(
        `Blikk returned an unexpected response when fetching users on page ${page}.`
      );
    }

    users.push(...response.items);
  }

  console.log(`✅ Fetched ${users.length} users from Blikk`);

  return users;
}

async function getCachedUsers(): Promise<BlikkUser[]> {
  const now = Date.now();

  if (userCache && userCache.expiresAt > now) {
    console.log("⚡ Using cached user list");
    return userCache.users;
  }

  if (userLoadPromise) {
    console.log("⏳ Waiting for ongoing user list fetch");
    return userLoadPromise;
  }

  console.log("♻️ User cache is empty or expired");

  const loadPromise = fetchAllUsers();
  userLoadPromise = loadPromise;

  try {
    const users = await loadPromise;

    userCache = {
      users,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    };

    console.log("✅ User cache updated");

    return users;
  } finally {
    if (userLoadPromise === loadPromise) {
      userLoadPromise = null;
    }
  }
}

async function getPlanningUsersForPeriod(
  fromDate: string,
  toDate: string
): Promise<BlikkPlanningUser[]> {
  const firstPage = (await getUsersWithResourcePlanning({
    fromDate,
    toDate,
    page: 1,
    pageSize: 100,
  })) as BlikkPlanningUserResponse;

  if (!firstPage || !Array.isArray(firstPage.items)) {
    throw new Error(
      "Blikk returned an unexpected response when fetching planning users."
    );
  }

  const users: BlikkPlanningUser[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(REQUEST_DELAY_MS);

    const response = (await getUsersWithResourcePlanning({
      fromDate,
      toDate,
      page,
      pageSize: 100,
    })) as BlikkPlanningUserResponse;

    if (!response || !Array.isArray(response.items)) {
      throw new Error(
        `Blikk returned an unexpected response when fetching planning users on page ${page}.`
      );
    }

    users.push(...response.items);
  }

  return users;
}

export async function getProjectCatalog(): Promise<
  ProjectCatalogItem[]
> {
  return getCachedProjects();
}

export async function resolveProjectId(
  projectName: string
): Promise<string> {
  const project = await resolveProject(projectName);

  return project.id;
}

export async function resolveProject(
  projectName: string
): Promise<ProjectCatalogItem> {
  const normalizedProjectName = normalize(projectName);

  if (!normalizedProjectName) {
    throw new Error("A project name is required.");
  }

  const projects = await getCachedProjects();

  const exactMatch = projects.find(
    (project) =>
      normalize(project.title) === normalizedProjectName
  );

  if (exactMatch) {
    return exactMatch;
  }

  const partialMatches = projects.filter((project) =>
    normalize(project.title).includes(normalizedProjectName)
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    const matchingNames = partialMatches
      .map((project) => project.title)
      .join(", ");

    throw new Error(
      `Multiple projects match '${projectName}': ${matchingNames}. Please specify the project name.`
    );
  }

  throw new Error(`Project '${projectName}' not found.`);
}

export async function resolvePlanningUserId(
  userName: string,
  fromDate: string,
  toDate: string
): Promise<string> {
  const normalizedUserName = normalize(userName);

  if (!normalizedUserName) {
    throw new Error("A user name is required.");
  }

  if (!fromDate || !toDate) {
    throw new Error(
      "Both fromDate and toDate are required to resolve a planning user."
    );
  }

  const users = await getPlanningUsersForPeriod(
    fromDate,
    toDate
  );

  const exactMatch = users.find((user) => {
    const fullName = getPlanningUserFullName(user);

    return normalize(fullName) === normalizedUserName;
  });

  if (exactMatch) {
    return String(exactMatch.id);
  }

  const partialMatches = users.filter((user) => {
    const fullName = getPlanningUserFullName(user);

    return normalize(fullName).includes(normalizedUserName);
  });

  if (partialMatches.length === 1) {
    return String(partialMatches[0].id);
  }

  if (partialMatches.length > 1) {
    const matchingNames = partialMatches
      .map(getPlanningUserFullName)
      .join(", ");

    throw new Error(
      `Multiple users with resource planning match '${userName}': ${matchingNames}. Please specify the full name.`
    );
  }

  throw new Error(
    `No user with resource planning matching '${userName}' was found between ${fromDate} and ${toDate}.`
  );
}

export async function resolveUserId(
  userName: string
): Promise<string> {
  const normalizedUserName = normalize(userName);

  if (!normalizedUserName) {
    throw new Error("A user name is required.");
  }

  const users = await getCachedUsers();

  const exactMatch = users.find((user) => {
    const fullName = getUserFullName(user);

    return normalize(fullName) === normalizedUserName;
  });

  if (exactMatch) {
    return String(exactMatch.id);
  }

  const partialMatches = users.filter((user) => {
    const fullName = getUserFullName(user);

    return normalize(fullName).includes(normalizedUserName);
  });

  if (partialMatches.length === 1) {
    return String(partialMatches[0].id);
  }

  if (partialMatches.length > 1) {
    const matchingNames = partialMatches
      .map(getUserFullName)
      .join(", ");

    throw new Error(
      `Multiple users match '${userName}': ${matchingNames}. Please specify the full user name.`
    );
  }

  throw new Error(`User '${userName}' not found.`);
}
