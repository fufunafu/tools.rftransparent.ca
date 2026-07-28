import { redirect } from "next/navigation";

// Problem Tickets moved under Customer Service (2026-07-28). This stub keeps
// old links working — the weekly digest emails already sent link here.
export default function ProblemsRedirect() {
  redirect("/customer-service/problems");
}
