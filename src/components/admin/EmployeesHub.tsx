"use client";

import { useState, useEffect } from "react";
import EmployeeList from "@/components/admin/EmployeeList";
import EmployeeSatisfaction from "@/components/admin/EmployeeSatisfaction";
import BirthdayCalendar from "@/components/admin/BirthdayCalendar";

interface Employee {
  id: string;
  name: string;
  birthday: string | null;
}

type Tab = "employees" | "satisfaction" | "birthdays";

const TABS: { key: Tab; label: string }[] = [
  { key: "employees", label: "Employees" },
  { key: "satisfaction", label: "Satisfaction" },
  { key: "birthdays", label: "Birthdays" },
];

export default function EmployeesHub() {
  const [tab, setTab] = useState<Tab>("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    fetch("/api/kpi/employees?active=false")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setEmployees(d))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-sand-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-sand-900 text-sand-900"
                : "border-transparent text-sand-400 hover:text-sand-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "employees" && <EmployeeList />}
      {tab === "satisfaction" && <EmployeeSatisfaction employees={employees} />}
      {tab === "birthdays" && <BirthdayCalendar employees={employees} />}
    </div>
  );
}
