export interface SalesRecordDetail {
  id: string;
  name: string;
  customerName?: string | null;
  date: string;
  amount: number;
  status: string;
  url: string;
}

export interface SalesRecordList {
  records: SalesRecordDetail[];
  total: number;
  warnings: string[];
}

export function shopifyRecordUrl(domain: string, gid: string, kind: "orders" | "quotes"): string {
  const id = gid.split("/").pop() ?? gid;
  return `https://${domain}/admin/${kind === "orders" ? "orders" : "draft_orders"}/${encodeURIComponent(id)}`;
}

export interface SalesRecordCustomer {
  customer?: { firstName?: string | null; lastName?: string | null } | null;
  shippingAddress?: { name?: string | null; company?: string | null } | null;
  billingAddress?: { name?: string | null; company?: string | null } | null;
}

export function salesRecordCustomerName(record: SalesRecordCustomer): string | null {
  const name = [record.customer?.firstName, record.customer?.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return [name, record.shippingAddress?.name, record.billingAddress?.name,
    record.shippingAddress?.company, record.billingAddress?.company]
    .map((value) => value?.trim()).find(Boolean) ?? null;
}
