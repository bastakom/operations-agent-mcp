import { getProjects, getUsers } from "./endpoints";

type BlikkProject = {
  id: string;
  name: string;
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
  const projects = (await getProjects()) as BlikkProject[];

  const normalizedProjectName = projectName.trim().toLowerCase();

  const exactMatch = projects.find(
    (project) =>
      project.name.trim().toLowerCase() === normalizedProjectName
  );

  if (exactMatch) {
    return exactMatch.id;
  }

  const partialMatches = projects.filter((project) =>
    project.name.trim().toLowerCase().includes(normalizedProjectName)
  );

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  }

  if (partialMatches.length > 1) {
    const matchingNames = partialMatches
      .map((project) => project.name)
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
