import "server-only";
import { getSupabase } from "@/lib/supabase";
import { CrmInputError } from "./input";
import { DIRECTORY_FIELDS, DIRECTORY_SORTS, emptyDirectoryFilters, type DirectoryOptions, type DirectorySort } from "./directory";

export function readDirectoryFilters(params: URLSearchParams) {
  const filters = emptyDirectoryFilters();
  for (const field of DIRECTORY_FIELDS) {
    const values = params.getAll(field);
    if (values.length > 20 || values.some(value => value.length > 500 || /[\u0000-\u001f\u007f]/.test(value))) throw new CrmInputError("Invalid directory filter");
    filters[field] = [...new Set(values.map(value => value.trim().toLowerCase()))];
  }
  const sort = params.get("sort") ?? "newest";
  if (!Object.hasOwn(DIRECTORY_SORTS, sort)) throw new CrmInputError("Invalid sort order");
  const source = params.get("source") ?? "";
  if (!["", "tools", "hubspot"].includes(source)) throw new CrmInputError("Invalid record source");
  return { filters, sort: sort as DirectorySort, source };
}

export async function getCrmDirectoryOptions(params: URLSearchParams): Promise<DirectoryOptions> {
  const type = params.get("type");
  if (type !== "contacts" && type !== "companies") throw new CrmInputError("Choose Contacts or Companies");
  const result = await getSupabase().rpc("crm_directory_filter_options", { p_type: type, p_archived: params.get("archived") === "true" });
  if (result.error || !result.data) throw new Error("CRM filters are unavailable");
  return result.data as DirectoryOptions;
}
