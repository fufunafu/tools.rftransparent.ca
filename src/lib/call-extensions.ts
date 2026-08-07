export function normalizeExtension(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return /^\d{2,4}$/.test(normalized) ? normalized : null;
}

export function listExtensions(rows: { endpoint: string | null }[]): string[] {
  return [...new Set(
    rows
      .map((row) => normalizeExtension(row.endpoint))
      .filter((extension): extension is string => extension !== null),
  )].sort((a, b) => Number(a) - Number(b));
}
