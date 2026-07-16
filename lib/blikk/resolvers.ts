import { getProjects, getUsers } from "./endpoints";

type BlikkProject = {
  id: number | string;
  title: string;
};

type BlikkProjectResponse = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: BlikkProject[];
};

type BlikkUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
};

type ProjectCache = {
  projects: BlikkProject[];
  expiresAt: number;
};

const PROJECT_CACHE_TTL_MS = 10 * 60 * 1000;

let projectCache: ProjectCache | null = null;
let projectLoadPromise: Promise<BlikkProject[]> | null = null;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fetchAllProjects(): Promise<BlikkProject[]> {
  console.log("📥 Fetching all projects from Blikk");

  const firstPage = (await getProjects({
    page: 1,
    pageSize: 100,
  })) as BlikkProjectResponse;

  const projects: BlikkProject[] = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    await wait(1100);

    const response = (await getProjects({
      page,
      pageSize: 100,
    })) as BlikkProjectResponse;

    projects.push(...response.items);
  }

  console.log(`✅ Fetched ${projects.length} projects from Blikk`);

  return projects;
}

async function getCachedProjects(): Promise<BlikkProject[]> {
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

export async function resolveProjectId(
  projectName: string
): Promise<string> {
  const normalizedProjectName = projectName.trim().toLowerCase();

  if (!normalizedProjectName) {
    throw new Error("A project name is required.");
  }

  const projects = await getCachedProjects();

  const exactMatch = projects.find(
    (project) =>
      project.title.trim().toLowerCase() === normalizedProjectName
  );

  if (exactMatch) {
    return String(exactMatch.id);
  }

  const partialMatches = projects.filter((project) =>
    project.title.trim().toLowerCase().includes(normalizedProjectName)
  );

  if (partialMatches.length === 1) {
    return String(partialMatches[0].id);
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

export async function resolveUserId(userName: string): Promise<string> {
  const users = (await getUsers()) as BlikkUser[];

  const user = users.find((u) => {
    const fullName =
      u.fullName ??
      u.name ??
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();

    return fullName.toLowerCase() === userName.toLowerCase();
  });

  if (!user) {
    throw new Error(`User '${userName}' not found.`);
  }

  return user.id;
}
