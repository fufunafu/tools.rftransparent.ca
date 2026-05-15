import { redirect } from "next/navigation";

export default function PurchasingIndex() {
  redirect("/warehouse/purchasing/inventory");
}
