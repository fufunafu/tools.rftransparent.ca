"use client";

import { emptyValue, resolveSchema, type ProductSchema } from "@/lib/amazon/domain";

export const inputClass = "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-900";
export const buttonClass = "rounded-lg border border-sand-300 px-3 py-2 text-sm font-medium hover:bg-sand-100 disabled:opacity-40";

export default function AttributeField({ schema, root, value, onChange, label, depth = 0 }: {
  schema: ProductSchema; root: ProductSchema; value: unknown; onChange: (value: unknown) => void; label: string; depth?: number;
}) {
  const field = resolveSchema(schema, root);
  if (depth > 12 || field.$ref) return <p className="text-sm text-amber-800">{label}: this field requires completion in Seller Central.</p>;
  if (field.type === "array") {
    const values = Array.isArray(value) ? value : [];
    return <fieldset className="space-y-3 rounded-lg border border-sand-200 p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {values.map((item, index) => <div key={index} className="space-y-2">
        <AttributeField schema={field.items ?? {}} root={root} value={item} label={`${label} ${index + 1}`} depth={depth + 1}
          onChange={(next) => onChange(values.map((old, i) => i === index ? next : old))} />
        <button type="button" className="text-xs text-red-700" onClick={() => onChange(values.filter((_, i) => i !== index))}>Remove {label.toLowerCase()} {index + 1}</button>
      </div>)}
      <button type="button" className={buttonClass} disabled={values.length >= Math.min(field.maxItems ?? 100, 100)} onClick={() => onChange([...values, emptyValue(field.items ?? {}, root)])}>Add {label.toLowerCase()}</button>
    </fieldset>;
  }
  if (field.type === "object" || field.properties) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(field.properties ?? {}).map(([key, child]) => {
      if (["marketplace_id", "language_tag"].includes(key)) return null;
      return <AttributeField key={key} schema={child} root={root} value={record[key]} depth={depth + 1}
        label={`${child.title ?? key.replaceAll("_", " ")}${field.required?.includes(key) ? " *" : ""}`}
        onChange={(next) => { const updated = { ...record, [key]: next }; if (next === undefined) delete updated[key]; onChange(updated); }} />;
    })}</div>;
  }
  const type = Array.isArray(field.type) ? field.type.find((item) => item !== "null") : field.type;
  const numeric = type === "number" || type === "integer";
  const options = field.enum ?? (field.const !== undefined ? [field.const as string] : undefined);
  return <label className="block space-y-1 text-sm">
    <span className="font-medium">{label}</span>
    {options ? <select className={inputClass} value={value === undefined ? "" : String(value)} onChange={(event) => onChange(options.find((option) => String(option) === event.target.value))}>
      <option value="">Choose...</option>{options.map((option, index) => <option key={String(option)} value={String(option)}>{field.enumNames?.[index] ?? String(option)}</option>)}
    </select> : type === "boolean" ? <select className={inputClass} value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}>
      <option value="">Choose...</option><option value="true">Yes</option><option value="false">No</option>
    </select> : <input className={inputClass} type={numeric ? "number" : "text"} step={type === "integer" ? "1" : "any"} min={field.minimum} max={field.maximum} maxLength={field.maxLength}
      value={typeof value === "string" || typeof value === "number" ? value : ""}
      onChange={(event) => onChange(event.target.value === "" ? undefined : numeric ? Number(event.target.value) : event.target.value)} />}
    {field.description && <span className="block text-xs text-sand-500">{field.description}</span>}
  </label>;
}
