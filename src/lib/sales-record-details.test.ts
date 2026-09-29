import { expect, it } from "vitest";
import { salesRecordCustomerName, type SalesRecordCustomer } from "./sales-record-details";

it.each<{ label: string; record: SalesRecordCustomer; expected: string | null }>([
  { label: "customer full name", record: { customer: { firstName: " Avery ", lastName: "Chen" }, shippingAddress: { name: "Site Contact" } }, expected: "Avery Chen" },
  { label: "shipping contact without customer", record: { customer: null, shippingAddress: { name: "Jordan Smith" } }, expected: "Jordan Smith" },
  { label: "billing contact for pickup", record: { shippingAddress: null, billingAddress: { name: "Casey Lee" } }, expected: "Casey Lee" },
  { label: "company when no person is named", record: { customer: { firstName: " " }, shippingAddress: { name: "", company: "Lakeview Glass" } }, expected: "Lakeview Glass" },
  { label: "missing names", record: {}, expected: null },
])("uses $label", ({ record, expected }) => {
  expect(salesRecordCustomerName(record)).toBe(expected);
});
