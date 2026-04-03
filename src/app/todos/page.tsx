import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import TodoList from "@/components/admin/TodoList";

export const metadata: Metadata = {
  title: "To-Do List | RF Tools",
  robots: { index: false, follow: false },
};

export default async function TodosPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <TodoList />
    </div>
  );
}
