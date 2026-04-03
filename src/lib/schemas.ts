/**
 * Zod schemas for runtime validation of external API responses.
 * Only covers the critical paths — revenue calculations and auth tokens.
 */
import { z } from "zod";

// --- OAuth token responses ---

export const OAuthTokenSchema = z.object({
  access_token: z.string().min(1, "Missing access_token"),
  expires_in: z.number().optional(),
});

// --- Shopify revenue fields (used in net revenue calculations) ---

export const RevenueFieldsSchema = z.object({
  subtotalPriceSet: z.object({
    shopMoney: z.object({
      amount: z.string(),
    }),
  }),
  shippingCostMeta: z.object({ value: z.string() }).nullable(),
  exportTariffMeta: z.object({ value: z.string() }).nullable(),
});

export const OrderNodeSchema = RevenueFieldsSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  tags: z.array(z.string()),
  cancelledAt: z.string().nullable().optional(),
  staffMember: z.object({
    firstName: z.string(),
    lastName: z.string(),
  }).nullable().optional(),
  currentSubtotalPriceSet: z.object({
    shopMoney: z.object({ amount: z.string() }),
  }).optional(),
});

export const OrdersResponseSchema = z.object({
  orders: z.object({
    edges: z.array(z.object({
      node: OrderNodeSchema,
      cursor: z.string(),
    })),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});

export const DraftOrderNodeSchema = RevenueFieldsSchema.extend({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
  order: z.object({
    id: z.string(),
    createdAt: z.string(),
  }).nullable(),
});

export const DraftOrdersResponseSchema = z.object({
  draftOrders: z.object({
    edges: z.array(z.object({
      node: DraftOrderNodeSchema,
      cursor: z.string(),
    })),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});

// --- Google Ads metrics ---

export const GoogleAdsMetricsSchema = z.object({
  costMicros: z.string().optional(),
  clicks: z.string().optional(),
  impressions: z.string().optional(),
  conversions: z.number().optional(),
  conversionsValue: z.number().optional(),
});
