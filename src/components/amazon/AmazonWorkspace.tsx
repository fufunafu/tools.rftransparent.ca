"use client";

import { useEffect, useRef, useState } from "react";
import { AMAZON_US, emptyValue, sourceToDraft, type ListingDraft, type ListingResult, type ProductSchema, type ProductSource } from "@/lib/amazon/domain";
import AttributeField, { buttonClass, inputClass } from "./AttributeField";

interface Setup { configured: boolean; missing: string[]; stores: { id: string; label: string }[] }
interface DraftRow { id: string; source: ProductSource; draft: ListingDraft; schema?: ProductSchema; receipt?: string; result?: ListingResult; error?: string; status?: string; uploaded?: boolean; uncertain?: boolean }
type Catalog = { items: ProductSource[]; hasNextPage: boolean; endCursor: string | null };
type ListingStatus = { listing: { summaries?: { asin: string; status: string[] }[]; issues?: ListingResult["issues"] } | null };

class ApiError extends Error {
  constructor(message: string, public status: number, public result?: ListingResult) { super(message); }
}

async function api<T>(params: Record<string, string>, body?: unknown): Promise<T> {
  const response = await fetch(`/api/amazon?${new URLSearchParams(params)}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? "Request failed", response.status, data.result);
  return data as T;
}

export default function AmazonWorkspace() {
  const [setup, setSetup] = useState<Setup>();
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<Catalog>();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [activeId, setActiveId] = useState("");
  const [typeSearch, setTypeSearch] = useState("glass railing");
  const [types, setTypes] = useState<{ name: string; displayName: string }[]>([]);
  const [attributeSearch, setAttributeSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmUpload, setConfirmUpload] = useState(false);
  const lock = useRef(false);
  const active = rows.find((row) => row.id === activeId);

  useEffect(() => {
    let cancelled = false;
    api<Setup>({ action: "setup" }).then((data) => {
      if (cancelled) return;
      setSetup(data);
      setStoreId(data.stores.find((store) => /glass railing/i.test(store.label))?.id ?? data.stores[0]?.id ?? "");
    }).catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, []);

  async function run(label: string, task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError("");
    try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); }
    finally { lock.current = false; setBusy(""); }
  }
  function update(id: string, patch: Partial<DraftRow>) { setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row)); }
  function edit(draft: ListingDraft) {
    if (!active) return;
    update(active.id, { draft, receipt: undefined, result: undefined, error: undefined });
    setConfirmUpload(false);
  }
  async function loadCatalog(more = false) {
    const data = await api<Catalog>({ action: "catalog", storeId, search, ...(more && catalog?.endCursor ? { after: catalog.endCursor } : {}) });
    setCatalog({ ...data, items: more ? [...(catalog?.items ?? []), ...data.items] : data.items });
  }
  function add(source: ProductSource) {
    const id = `${storeId}:${source.id}`;
    if (!rows.some((row) => row.id === id)) {
      setRows((current) => [...current, { id, source, draft: sourceToDraft(source) }]);
    }
    setActiveId(id); setAttributeSearch(""); setConfirmUpload(false);
  }
  async function chooseType(productType: string) {
    if (!active) return;
    const { schema } = await api<{ schema: ProductSchema }>({ action: "definition", productType });
    // Preserve shared product facts, but remove attributes from an earlier category.
    const attributes = Object.fromEntries(Object.entries(active.draft.attributes).filter(([name]) => schema.properties?.[name]));
    for (const key of schema.required ?? []) {
      const field = schema.properties?.[key];
      if (field && !attributes[key]) attributes[key] = (emptyValue(field, schema) ?? []) as unknown[];
    }
    update(active.id, { schema, draft: { ...active.draft, productType, attributes }, receipt: undefined, result: undefined, error: undefined });
    setConfirmUpload(false);
  }
  async function validateAll() {
    const skuCounts = new Map<string, number>();
    for (const row of rows) skuCounts.set(row.draft.sku.trim(), (skuCounts.get(row.draft.sku.trim()) ?? 0) + 1);
    let first = true;
    for (const row of rows.filter((item) => !item.uploaded && !item.uncertain)) {
      if ((skuCounts.get(row.draft.sku.trim()) ?? 0) > 1) {
        update(row.id, { receipt: undefined, error: "Each variant needs a unique Amazon SKU. Resolve duplicate SKUs in this batch." });
        continue;
      }
      if (!first) await new Promise((resolve) => setTimeout(resolve, 1100));
      first = false;
      try {
        const data = await api<{ result: ListingResult; receipt: string | null }>({}, { action: "validate", draft: row.draft });
        update(row.id, { result: data.result, receipt: data.receipt ?? undefined, error: undefined });
      } catch (reason) { update(row.id, { receipt: undefined, error: (reason as Error).message }); }
    }
  }
  async function uploadReady() {
    setConfirmUpload(false);
    const skus = rows.map((row) => row.draft.sku.trim());
    if (new Set(skus).size !== skus.length) throw new Error("Resolve duplicate SKUs and validate the batch again.");
    let first = true;
    for (const row of rows.filter((item) => item.receipt && !item.uploaded && !item.uncertain)) {
      if (!first) await new Promise((resolve) => setTimeout(resolve, 1100));
      first = false;
      try {
        const data = await api<{ result: ListingResult }>({}, { action: "submit", draft: row.draft, receipt: row.receipt });
        update(row.id, { result: data.result, receipt: undefined, uploaded: data.result.status === "ACCEPTED", error: undefined });
      } catch (reason) {
        // A timeout may have occurred after Amazon accepted the listing.
        const uncertain = !(reason instanceof ApiError) || reason.status >= 500;
        update(row.id, { receipt: undefined, uncertain, result: reason instanceof ApiError ? reason.result : undefined, error: (reason as Error).message });
      }
    }
  }
  async function checkStatus(row: DraftRow) {
    const data = await api<ListingStatus>({ action: "status", sku: row.draft.sku });
    if (data.listing) {
      const summaries = data.listing.summaries ?? [];
      update(row.id, { uploaded: true, uncertain: false, receipt: undefined, error: undefined,
        status: summaries.map((item) => `${item.asin}: ${item.status.join(", ")}`).join("; ") || "Listing received. Amazon is still processing it.",
        result: { sku: row.draft.sku, status: "RECEIVED", issues: data.listing.issues },
      });
    } else update(row.id, { status: "Not visible on Amazon yet. Allow processing time and check again before retrying." });
  }
  function downloadDrafts() {
    const content = JSON.stringify({ version: 1, marketplace: AMAZON_US, items: rows.map(({ source, draft, result, status }) => ({ source, draft, result, status })) }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "amazon-us-listings.json"; link.click(); URL.revokeObjectURL(url);
  }

  const ready = rows.filter((row) => row.receipt && !row.uploaded && !row.uncertain);
  const activeAttributes = active ? Object.entries(active.draft.attributes) : [];
  const availableAttributes = active?.schema?.properties ? Object.entries(active.schema.properties).filter(([key, field]) => !active.draft.attributes[key] && `${key} ${field.title}`.toLowerCase().includes(attributeSearch.toLowerCase())) : [];

  return <div className="space-y-6 text-sand-900">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-sand-500">Sales channels</p><h1 className="mt-1 text-2xl font-semibold">Amazon hardware uploads</h1>
      <p className="mt-2 text-sm text-sand-600">Prepare Glass Railing Store hardware for Amazon US. Glass panels, custom glass, and mixed sample kits are excluded.</p></header>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {!setup && !error && <p role="status">Loading connections...</p>}
    {setup && <section className={`rounded-xl border p-4 ${setup.configured ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <h2 className="font-semibold">{setup.configured ? "Amazon credentials configured" : "Connect your Amazon seller account"}</h2>
      <p className="mt-1 text-sm">United States marketplace · Prices in USD · Seller-fulfilled listings</p>
      {!setup.configured && <div className="mt-3 space-y-2 text-sm">
        <p>You can browse Shopify and prepare drafts now. Amazon category requirements, validation, and uploads become available after connection.</p>
        <ol className="list-decimal space-y-1 pl-5"><li>Sign in as the primary user of your Professional Amazon seller account.</li><li>Open Apps and Services, then Develop Apps. Register a private application with the Product Listing role.</li><li>Authorize the app for your seller account and have its credentials installed securely on the server.</li></ol>
        <a className="inline-block font-medium underline" href="https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer" target="_blank" rel="noreferrer">Amazon setup instructions</a>
      </div>}
      {setup.configured && <p className="mt-1 text-xs">The first category search verifies access to Amazon.</p>}
    </section>}

    <fieldset disabled={Boolean(busy)} className="space-y-4 rounded-xl border border-sand-200 bg-white p-5">
      <legend className="px-1 font-semibold">1. Choose products</legend>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run("Loading products", () => loadCatalog()); }}>
        <label className="min-w-48 flex-1 text-sm">Shopify store<select className={inputClass} value={storeId} onChange={(event) => { setStoreId(event.target.value); setCatalog(undefined); }}>
          {setup?.stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
        </select></label>
        <label className="min-w-48 flex-1 text-sm">Search products or SKU<input className={inputClass} value={search} onChange={(event) => { setSearch(event.target.value); setCatalog(undefined); }} placeholder="e.g. spigot or sku:ABC123" /></label>
        <button className={buttonClass} disabled={!storeId} type="submit">Find products</button>
      </form>
      {catalog && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-sand-200 text-sand-500"><th className="p-2">Product / variant</th><th className="p-2">SKU</th><th className="p-2">US market price</th><th className="p-2">Shopify stock</th><th className="p-2"><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{catalog.items.map((source) => <tr key={source.id} className="border-b border-sand-100"><td className="max-w-sm p-2">{source.title}{!source.barcode && <span className="block text-xs text-amber-800">Barcode missing: needs an identifier or approved exemption</span>}</td><td className="p-2">{source.sku || "Missing SKU"}</td><td className="whitespace-nowrap p-2">{source.price} {source.currency}</td><td className="p-2">{source.inventory ?? "Unknown"}</td><td className="p-2"><button type="button" className={buttonClass} disabled={rows.length >= 20 && !rows.some((row) => row.id === `${storeId}:${source.id}`)} onClick={() => add(source)}>{rows.some((row) => row.id === `${storeId}:${source.id}`) ? "Review" : "Add"}</button></td></tr>)}</tbody>
      </table>{catalog.items.length === 0 && <p className="py-4 text-sm">No approved hardware on this page. Use Load more if more pages are available.</p>}</div>}
      {catalog?.hasNextPage && <button type="button" className={buttonClass} onClick={() => void run("Loading more products", () => loadCatalog(true))}>Load more</button>}
      <p className="text-xs text-sand-500">Up to 20 variants per batch. Each variant becomes a standalone Amazon listing. Amazon stock starts at zero until you allocate a quantity.</p>
    </fieldset>

    {rows.length > 0 && <section className="space-y-4 rounded-xl border border-sand-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">2. Review listing details</h2><button type="button" className={buttonClass} onClick={downloadDrafts}>Download drafts and results</button></div>
      <p className="text-xs text-sand-500">Drafts stay on this screen until you leave. Download a copy to keep your work.</p>
      <div className="flex flex-wrap gap-2">{rows.map((row) => <button key={row.id} type="button" disabled={Boolean(busy)} className={`${buttonClass} ${row.id === activeId ? "bg-sand-900 text-white hover:bg-sand-800" : ""}`} onClick={() => { setActiveId(row.id); setAttributeSearch(""); setConfirmUpload(false); }}>{row.draft.sku || "New SKU"} · {row.uploaded ? "Received" : row.uncertain ? "Check status" : row.error ? "Needs attention" : row.receipt ? "Validated" : "Draft"}</button>)}</div>
      {active && <div className="space-y-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{active.source.title}</h3><p className="text-xs text-sand-500">Source: {active.source.price} {active.source.currency}. Review brand, identifiers, shipping, and product claims before upload.</p></div>
          <button type="button" className="text-sm text-red-700" disabled={Boolean(busy)} onClick={() => { setRows((current) => current.filter((row) => row.id !== active.id)); setActiveId(rows.find((row) => row.id !== active.id)?.id ?? ""); setConfirmUpload(false); }}>Remove</button></div>
        {active.source.currency !== "USD" && <p className="rounded-lg bg-amber-50 p-3 text-sm">Shopify returned {active.source.currency}. Set an explicit USD offer price in the listing details; no currency conversion has been assumed.</p>}
        <fieldset disabled={Boolean(busy) || active.uploaded || active.uncertain} className="space-y-4">
          <label className="block text-sm">Amazon SKU<input className={inputClass} maxLength={40} value={active.draft.sku} onChange={(event) => edit({ ...active.draft, sku: event.target.value })} /></label>
          <div className="flex flex-wrap items-end gap-2"><label className="min-w-48 flex-1 text-sm">Find an Amazon category<input className={inputClass} value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} /></label>
            <button type="button" className={buttonClass} disabled={!setup?.configured} onClick={() => void run("Searching categories", async () => { setTypes((await api<{ productTypes: typeof types }>({ action: "types", search: typeSearch })).productTypes); })}>Search categories</button></div>
          <label className="block text-sm">Amazon product type<select className={inputClass} value={active.draft.productType} disabled={!setup?.configured} onChange={(event) => { if (event.target.value) void run("Loading requirements", () => chooseType(event.target.value)); }}>
            <option value="">Choose a category</option>{active.draft.productType && !types.some((type) => type.name === active.draft.productType) && <option value={active.draft.productType}>{active.draft.productType}</option>}
            {types.map((type) => <option key={type.name} value={type.name}>{type.displayName} ({type.name})</option>)}
          </select></label>
          {!active.schema && <div className="space-y-3"><label className="block text-sm">Listing title<input className={inputClass} value={String((active.draft.attributes.item_name?.[0] as { value?: string })?.value ?? "")} onChange={(event) => edit({ ...active.draft, attributes: { ...active.draft.attributes, item_name: [{ value: event.target.value, language_tag: "en_US", marketplace_id: AMAZON_US }] } })} /></label><p className="text-sm text-sand-500">Choose a category to edit all Amazon fields, including brand, barcode, description, images, USD price, and shipping.</p></div>}
          {active.schema && <>
            <p className="text-xs text-sand-500">Fields marked * are required by the base category definition. Amazon validation checks additional conditional requirements.</p>
            {activeAttributes.map(([key, value]) => active.schema?.properties?.[key] && <div key={key} className="space-y-1">
              <AttributeField schema={active.schema.properties[key]} root={active.schema} value={value} label={`${active.schema.properties[key].title ?? key.replaceAll("_", " ")}${active.schema.required?.includes(key) ? " *" : ""}`} onChange={(next) => edit({ ...active.draft, attributes: { ...active.draft.attributes, [key]: next as unknown[] } })} />
              <button type="button" className="text-xs text-red-700" onClick={() => { const attributes = { ...active.draft.attributes }; delete attributes[key]; edit({ ...active.draft, attributes }); }}>Remove field</button>
            </div>)}
            <details className="rounded-lg bg-sand-50 p-3"><summary className="cursor-pointer text-sm font-medium">Add another product detail</summary>
              <label className="mt-3 block text-sm">Find a field<input className={inputClass} value={attributeSearch} onChange={(event) => setAttributeSearch(event.target.value)} placeholder="e.g. material, dimensions, shipping" /></label>
              <div className="mt-2 flex max-h-64 flex-wrap gap-2 overflow-auto">{availableAttributes.map(([key, field]) => <button key={key} type="button" className={buttonClass} onClick={() => edit({ ...active.draft, attributes: { ...active.draft.attributes, [key]: (emptyValue(field, active.schema!) ?? []) as unknown[] } })}>{field.title ?? key.replaceAll("_", " ")}</button>)}</div>
            </details>
          </>}
        </fieldset>
        {active.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{active.error}</p>}
        {active.result && <div className="space-y-2 rounded-lg bg-sand-50 p-3 text-sm"><p className="font-medium">Amazon response: {active.result.status}</p>{active.result.submissionId && <p className="break-all text-xs">Submission: {active.result.submissionId}</p>}
          {active.result.issues?.map((issue, index) => <p key={`${issue.code}:${index}`} className={issue.severity === "ERROR" ? "text-red-800" : "text-amber-800"}>{issue.severity}: {issue.message}{issue.attributeNames?.length ? ` (${issue.attributeNames.join(", ")})` : ""}</p>)}
        </div>}
        {(active.uploaded || active.uncertain) && <div className="space-y-2 text-sm"><p>Amazon may continue processing after accepting a submission. Check status to see whether it is buyable and whether further issues were found.</p>
          <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => void run("Checking Amazon status", () => checkStatus(active))}>Check Amazon status</button>
          {active.uncertain && <button type="button" className={`${buttonClass} ml-2`} disabled={Boolean(busy)} onClick={() => update(active.id, { uncertain: false, error: undefined, receipt: undefined })}>Reopen draft after checking Seller Central</button>}
          {active.status && <p role="status">{active.status}</p>}
        </div>}
      </div>}
    </section>}

    {rows.length > 0 && <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-5"><h2 className="font-semibold">3. Validate and upload</h2>
      <p className="text-sm text-sand-600">Validation sends a preview to Amazon without creating a listing. Any edits require a new validation. Existing Amazon SKUs are not overwritten.</p>
      <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={Boolean(busy) || !setup?.configured || !rows.some((row) => !row.uploaded && !row.uncertain)} onClick={() => void run("Validating listings", validateAll)}>Validate drafts with Amazon</button>
        <button type="button" className={`${buttonClass} bg-sand-900 text-white hover:bg-sand-800`} disabled={Boolean(busy) || !ready.length} onClick={() => setConfirmUpload(true)}>Review upload ({ready.length})</button></div>
      {confirmUpload && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="font-medium">Upload {ready.length} listing{ready.length === 1 ? "" : "s"} to Amazon US?</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{ready.map((row) => { const offer = row.draft.attributes.purchasable_offer?.[0] as { currency?: string; our_price?: { schedule?: { value_with_tax?: number }[] }[] } | undefined; const fulfillment = row.draft.attributes.fulfillment_availability?.[0] as { quantity?: number } | undefined;
          return <li key={row.id}>{row.draft.sku}: {offer?.our_price?.[0]?.schedule?.[0]?.value_with_tax ?? "No price"} {offer?.currency ?? "USD"}, Amazon quantity {fulfillment?.quantity ?? "not set"}</li>; })}</ul>
        <p className="text-sm">Listings with stock may become available to customers after Amazon processes them.</p>
        <button type="button" className={`${buttonClass} bg-sand-900 text-white hover:bg-sand-800`} disabled={Boolean(busy)} onClick={() => void run("Uploading listings", uploadReady)}>Upload these listings</button>
        <button type="button" className={`${buttonClass} ml-2`} disabled={Boolean(busy)} onClick={() => setConfirmUpload(false)}>Cancel</button>
      </div>}
    </section>}
    {busy && <p role="status" className="sticky bottom-4 rounded-xl bg-sand-900 p-3 text-sm text-white shadow-lg">{busy}...</p>}
  </div>;
}
