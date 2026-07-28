import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fetchAllPages drives shopifyGraphQL, which needs a configured store and a
// network. Stub the env before (re)importing the module and stub global fetch
// to serve canned GraphQL pages.

interface Node { id: string }

function page(nodes: Node[], hasNextPage: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        orders: {
          edges: nodes.map((n, i) => ({ node: n, cursor: `cursor-${n.id}-${i}` })),
          pageInfo: { hasNextPage },
        },
      },
    }),
  } as Response;
}

async function importShopify() {
  vi.resetModules();
  return await import("@/lib/shopify");
}

describe("fetchAllPages", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("SHOPIFY_STORE_1", "test.myshopify.com");
    vi.stubEnv("SHOPIFY_ACCESS_TOKEN_1", "shpat_test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("collects nodes across pages and passes the cursor as a variable", async () => {
    const { fetchAllPages } = await importShopify();
    fetchMock
      .mockResolvedValueOnce(page([{ id: "a" }, { id: "b" }], true))
      .mockResolvedValueOnce(page([{ id: "c" }], false));

    const { nodes, truncated } = await fetchAllPages<Node>({
      storeId: "store1",
      query: "query($after: String) { ... }",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getConnection: (data: any) => data.orders,
    });

    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First page: no cursor. Second page: last cursor of page 1, sent as a
    // GraphQL variable (not interpolated into the query).
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(firstBody.variables.after).toBeNull();
    expect(secondBody.variables.after).toBe("cursor-b-1");
  });

  it("stops at maxPages and reports truncation when more pages remain", async () => {
    const { fetchAllPages } = await importShopify();
    fetchMock.mockResolvedValue(page([{ id: "x" }], true));

    const { nodes, truncated } = await fetchAllPages<Node>({
      storeId: "store1",
      query: "q",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getConnection: (data: any) => data.orders,
      maxPages: 3,
    });

    expect(nodes).toHaveLength(3);
    expect(truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops cleanly on an empty page", async () => {
    const { fetchAllPages } = await importShopify();
    fetchMock.mockResolvedValueOnce(page([], true));

    const { nodes, truncated } = await fetchAllPages<Node>({
      storeId: "store1",
      query: "q",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getConnection: (data: any) => data.orders,
    });

    expect(nodes).toEqual([]);
    // hasNextPage was true but there is no cursor to continue from.
    expect(truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
