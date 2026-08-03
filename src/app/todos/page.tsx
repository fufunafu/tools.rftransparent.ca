import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated, isManagementUser } from "@/lib/admin-auth";
import TodoList from "@/components/admin/TodoList";

export const metadata: Metadata = {
  title: "Tasks | RF Tools",
  robots: { index: false, follow: false },
};

export default async function TodosPage() {
  if (!(await isAuthenticated())) redirect("/login");
  // Only management can switch into All-tasks oversight mode.
  const canSeeAll = await isManagementUser();

  return (
    <div className="mx-auto max-w-5xl">
      <TodoList canSeeAll={canSeeAll} />
    </div>
  );
}
