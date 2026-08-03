export interface SalesRepCandidate {
  id: string;
  department: string | null;
  shopify_tags: string[] | null;
}

export interface SalesRep {
  id: string;
  tags: string[];
}

export type SalesAttribution =
  | { status: "unique"; employeeId: string }
  | { status: "unassigned" }
  | { status: "ambiguous" };

function normalizedTags(tags: string[] | null | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** Only explicit tags on active sales employees are valid rep identifiers. */
export function configuredSalesReps(employees: SalesRepCandidate[]): SalesRep[] {
  return employees
    .filter((employee) => (employee.department ?? "").toLowerCase() === "sales")
    .map((employee) => ({ id: employee.id, tags: normalizedTags(employee.shopify_tags) }))
    .filter((employee) => employee.tags.length > 0);
}

/**
 * Attribute a Shopify record only when its tags identify exactly one rep.
 * Location and workflow tags are ignored because they are not configured as
 * rep tags. Multiple aliases for the same rep are still one unambiguous match.
 */
export function resolveSalesAttribution(
  recordTags: string[],
  reps: SalesRep[]
): SalesAttribution {
  const tags = new Set(normalizedTags(recordTags));
  const matches = reps.filter((rep) => rep.tags.some((tag) => tags.has(tag)));

  if (matches.length === 0) return { status: "unassigned" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "unique", employeeId: matches[0].id };
}
