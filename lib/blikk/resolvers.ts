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

export async function resolveProjectId(projectName: string): Promise<string> {
  const projects = (await getProjects()) as BlikkProject[];

  const project = projects.find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );

  if (!project) {
    throw new Error(`Project '${projectName}' not found.`);
  }

  return project.id;
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
