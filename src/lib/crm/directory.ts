export const DIRECTORY_FIELDS = ["owner", "stage", "country", "region", "city"] as const;
export type DirectoryField = typeof DIRECTORY_FIELDS[number];
export type DirectoryFilters = Record<DirectoryField, string[]>;
export interface DirectoryOption { value: string; label: string; count: number }
export type DirectoryOptions = Record<DirectoryField, DirectoryOption[]>;
export const DIRECTORY_LABELS: Record<DirectoryField, string> = {
  owner: "Owner", stage: "Lifecycle stage", country: "Country", region: "State / province", city: "City",
};
export const DIRECTORY_SORTS = { newest: "Newest added", oldest: "Oldest added", name_asc: "Name A to Z", name_desc: "Name Z to A" } as const;
export type DirectorySort = keyof typeof DIRECTORY_SORTS;
export const emptyDirectoryFilters = (): DirectoryFilters => ({ owner: [], stage: [], country: [], region: [], city: [] });
export const directoryFilterCount = (filters: DirectoryFilters) => DIRECTORY_FIELDS.reduce((sum, field) => sum + filters[field].length, 0);

export function appendDirectoryFilters(params: URLSearchParams, filters: DirectoryFilters, sort: DirectorySort, source: string) {
  for (const field of DIRECTORY_FIELDS) for (const value of filters[field]) params.append(field, value);
  if (sort !== "newest") params.set("sort", sort);
  if (source) params.set("source", source);
}

export function recordLocation(fields?: Record<string, string>) {
  return [fields?.city, fields?.region, fields?.country].filter(Boolean).join(", ");
}
