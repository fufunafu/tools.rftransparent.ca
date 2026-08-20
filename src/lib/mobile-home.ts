import type { MobileRoleAction } from "@/lib/mobile-types";

const actions = {
  sales: [
    { id: "sales", label: "My sales", description: "Quotes and results", href: "/sales" },
    { id: "followups", label: "My follow-ups", description: "Customers waiting for you", href: "/customer-service/follow-up" },
  ],
  warehouse: [
    { id: "warehouse-report", label: "Daily report", description: "Record today's production", href: "/warehouse/report" },
    { id: "problems", label: "Problem tickets", description: "Report an operational issue", href: "/customer-service/problems" },
    { id: "order-stream", label: "Order Stream", description: "Open the shipping tool", href: "https://orderstream-checker.vercel.app/", external: true },
    { id: "customs", label: "Customs invoice", description: "Prepare customs paperwork", href: "https://orderstream-checker.vercel.app/customs", external: true },
  ],
  customer_service: [
    { id: "callbacks", label: "My callbacks", description: "Calls that need a response", href: "/customer-service#callbacks" },
    { id: "followups", label: "My follow-ups", description: "Customers waiting for you", href: "/customer-service#followups" },
  ],
  marketing: [
    { id: "marketing", label: "Campaign summary", description: "Current campaign performance", href: "/dashboards/marketing" },
    { id: "problems", label: "Problem tickets", description: "Open customer issues", href: "/customer-service/problems" },
  ],
  management: [
    { id: "employees", label: "Employees", description: "People and performance", href: "/employees" },
    { id: "warehouse", label: "Warehouse", description: "Daily operational summary", href: "/warehouse" },
  ],
} satisfies Record<string, MobileRoleAction[]>;

export function mobileRoleActions(department: string | null | undefined): MobileRoleAction[] {
  if (department && department in actions) {
    return actions[department as keyof typeof actions];
  }
  return [
    { id: "problems", label: "Problem tickets", description: "Open customer issues", href: "/customer-service/problems" },
  ];
}
