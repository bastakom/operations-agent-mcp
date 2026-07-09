import type { BlikkPagedList } from "./types";

export function summarizePagedList<T>(list: BlikkPagedList<T>) {
  return {
    page: list.page,
    pageSize: list.pageSize,
    itemCount: list.itemCount,
    totalItemCount: list.totalItemCount,
    totalPages: list.totalPages,
    items: list.items ?? [],
  };
}

export function asPrettyJson(data: unknown) {
  return JSON.stringify(data, null, 2);
}
