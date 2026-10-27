import { REVENUE_FIELDS } from "@/lib/shopify";

export const PERFORMER_ORDERS_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 25, after: $after, query: $filter, sortKey: UPDATED_AT) {
      edges {
        node {
          id name createdAt updatedAt
          customer { firstName lastName }
          tags
          shippingAddress { provinceCode province countryCodeV2 name company }
          billingAddress { provinceCode province countryCodeV2 name company }
          currentTotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentShippingPriceSet { shopMoney { amount } }
          totalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          transactions(first: 50) {
            kind status processedAt amountSet { shopMoney { amount } }
          }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

export const PERFORMER_DRAFTS_QUERY = `
  query($after: String, $filter: String!) {
    draftOrders(first: 250, after: $after, query: $filter) {
      edges {
        node {
          id name createdAt updatedAt status tags ${REVENUE_FIELDS}
          customer { firstName lastName }
          shippingAddress { provinceCode province countryCodeV2 name company }
          billingAddress { provinceCode province countryCodeV2 name company }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;
