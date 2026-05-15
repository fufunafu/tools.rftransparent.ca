// Minimal CSV helpers for the inventory bulk-update flow.

export function escapeCSVField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCSV(rows: Array<Array<string | number | null>>): string {
  return rows.map((r) => r.map(escapeCSVField).join(",")).join("\r\n");
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (row.length === 1 && row[0] === "") {
        row = [];
        continue;
      }
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
    i++;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}
