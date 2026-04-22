"use client";

// TEMPORARY DIAGNOSTIC — safe to delete along with /api/shopify-debug.
// Test a Shopify custom app's credentials without touching any config.

import { useState } from "react";

export default function ShopifyDebugPage() {
  const [store, setStore] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [envResult, setEnvResult] = useState<unknown>(null);

  async function runCustom(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/shopify-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, clientId, clientSecret }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function runEnv() {
    setLoading(true);
    setEnvResult(null);
    try {
      const res = await fetch("/api/shopify-debug");
      setEnvResult(await res.json());
    } catch (err) {
      setEnvResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Shopify App Diagnostic</h1>
        <p className="text-sm text-gray-600 mt-1">
          Paste any Client ID / Secret to see which app Shopify thinks it is, what
          scopes it has, and whether <code>staffMembers</code> works — without
          changing any config.
        </p>
      </header>

      <form onSubmit={runCustom} className="space-y-3 border rounded-lg p-4 bg-white">
        <h2 className="font-medium">Test arbitrary credentials</h2>
        <label className="block text-sm">
          Store domain (e.g. <code>7135c9-32.myshopify.com</code>)
          <input
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="foo.myshopify.com"
            className="mt-1 w-full border rounded px-2 py-1 font-mono text-sm"
            required
          />
        </label>
        <label className="block text-sm">
          Client ID
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1 font-mono text-sm"
            required
          />
        </label>
        <label className="block text-sm">
          Client Secret
          <input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            type="password"
            className="mt-1 w-full border rounded px-2 py-1 font-mono text-sm"
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-1.5 bg-black text-white rounded text-sm disabled:opacity-50"
        >
          {loading ? "Testing…" : "Test credentials"}
        </button>
      </form>

      {result !== null && (
        <section>
          <h3 className="font-medium mb-2">Result</h3>
          <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      )}

      <div className="border-t pt-6">
        <h2 className="font-medium mb-2">Or — probe all stores using current env</h2>
        <button
          onClick={runEnv}
          disabled={loading}
          className="px-4 py-1.5 bg-gray-700 text-white rounded text-sm disabled:opacity-50"
        >
          {loading ? "Running…" : "Run env-based diagnostic"}
        </button>
        {envResult !== null && (
          <pre className="mt-3 text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-auto">
            {JSON.stringify(envResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
