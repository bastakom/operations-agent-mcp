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

export async function resolveProjectId(
  projectName: string
): Promise<string> {
  const normalizedProjectName = projectName.trim().toLowerCase();

  if (!normalizedProjectName) {
    throw new Error("A project name is required.");
  }

  const firstPage = (await getProjects({
    page: 1,
    pageSize: 100,
  })) as BlikkProjectResponse;

  const remainingPageNumbers = Array.from(
    { length: Math.max(firstPage.totalPages - 1, 0) },
    (_, index) => index + 2
  );

  const remainingPages = await Promise.all(
    remainingPageNumbers.map(
      async (page) =>
        (await getProjects({
          page,
          pageSize: 100,
        })) as BlikkProjectResponse
    )
  );

  const projects = [
    ...firstPage.items,
    ...remainingPages.flatMap((response) => response.items),
  ];

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
