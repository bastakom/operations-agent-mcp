export type BlikkTokenResponse = {
  objectName?: string;
  accessToken: string;
  expires?: string;
};

export type BlikkPagedList<T = unknown> = {
  objectName?: string;
  page?: number;
  pageSize?: number;
  itemCount?: number;
  totalItemCount?: number;
  totalPages?: number;
  items?: T[];
};

export type BlikkUser = Record<string, unknown>;
export type BlikkProject = Record<string, unknown>;
export type BlikkTimeReport = Record<string, unknown>;
