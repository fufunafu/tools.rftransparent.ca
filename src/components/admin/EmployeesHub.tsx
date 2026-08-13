"use client";

import { useEffect, useState, type ReactNode } from "react";
import EmployeeList from "@/components/admin/EmployeeList";
import EmployeeSatisfaction from "@/components/admin/EmployeeSatisfaction";
import BirthdayCalendar from "@/components/admin/BirthdayCalendar";
import EmployeePerformanceDashboard from "@/components/admin/EmployeePerformanceDashboard";
import HoursPanel from "@/components/admin/HoursPanel";

interface Employee {
  id: string;
  name: string;
  birthday: string | null;
  active?: boolean;
}

type Tab = "employees" | "hours" | "performance" | "satisfaction" | "birthdays";

function DirectoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <circle cx="8.5" cy="8.25" r="3" />
      <path strokeLinecap="round" d="M3.25 19a5.25 5.25 0 0 1 10.5 0" />
      <path strokeLinecap="round" d="M15.5 7.25h5m-5 4h5m-5 4h3.5" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2-5 4 10 2.25-5H21" />
    </svg>
  );
}

function PerformanceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <rect x="3.5" y="5.25" width="17" height="15" rx="2.5" />
      <path strokeLinecap="round" d="M8 3.5v3.25M16 3.5v3.25M3.75 9.5h16.5" />
    </svg>
  );
}

const BASE_TABS: { key: Tab; label: string; shortLabel: string; icon: ReactNode }[] = [
  { key: "employees", label: "Employee directory", shortLabel: "Directory", icon: <DirectoryIcon /> },
  { key: "birthdays", label: "Birthday calendar", shortLabel: "Birthdays", icon: <CalendarIcon /> },
];

const SATISFACTION_TAB = {
  key: "satisfaction" as const,
  label: "Team surveys",
  shortLabel: "Surveys",
  icon: <PulseIcon />,
};

function HoursIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

const HOURS_TAB = {
  key: "hours" as const,
  label: "Hours",
  shortLabel: "Hours",
  icon: <HoursIcon />,
};

const PERFORMANCE_TAB = {
  key: "performance" as const,
  label: "Team performance",
  shortLabel: "Performance",
  icon: <PerformanceIcon />,
};

export default function EmployeesHub({ canViewPerformance }: { canViewPerformance: boolean }) {
  const [tab, setTab] = useState<Tab>("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const tabs = canViewPerformance
    ? [BASE_TABS[0], HOURS_TAB, PERFORMANCE_TAB, SATISFACTION_TAB, BASE_TABS[1]]
    : BASE_TABS;

  useEffect(() => {
    fetch("/api/kpi/employees?active=false")
      .then((response) => response.json())
      .then((data) => Array.isArray(data) && setEmployees(data))
      .catch(() => {});
  }, []);

  const activeEmployees = employees.filter((employee) => employee.active !== false).length;

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7 sm:py-7">
        <div className="absolute right-0 top-0 h-48 w-48 translate-x-14 -translate-y-16 rounded-full bg-blue-100/70 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">
              <DirectoryIcon />
              People
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">Employee hub</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Keep your team directory current, understand how people are doing, and stay ahead of important moments.
            </p>
          </div>
          {employees.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-sm font-semibold text-emerald-700">
                {activeEmployees}
              </span>
              <span>
                <span className="block text-xs font-semibold text-slate-700">Active teammates</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{employees.length} total profiles</span>
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Employee tools">
        <div className={`grid gap-1.5 ${canViewPerformance ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2"}`}>
          {tabs.map((item) => {
            const selected = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`employee-panel-${item.key}`}
                id={`employee-tab-${item.key}`}
                onClick={() => setTab(item.key)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                  selected
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                <span className={selected ? "text-blue-300" : "text-slate-400"}>{item.icon}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`employee-panel-${tab}`}
        aria-labelledby={`employee-tab-${tab}`}
      >
        {tab === "employees" && <EmployeeList />}
        {tab === "hours" && canViewPerformance && <HoursPanel />}
        {tab === "performance" && canViewPerformance && <EmployeePerformanceDashboard />}
        {tab === "satisfaction" && canViewPerformance && <EmployeeSatisfaction employees={employees} />}
        {tab === "birthdays" && <BirthdayCalendar employees={employees} />}
      </div>
    </div>
  );
}
