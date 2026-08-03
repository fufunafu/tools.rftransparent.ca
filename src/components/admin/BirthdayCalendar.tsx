"use client";

import { useMemo, useState } from "react";

interface EmployeeStub {
  id: string;
  name: string;
  birthday: string | null;
}

function CakeIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11.25h14v8.25H5zM4 19.5h16M8 11.25V8.5h8v2.75M12 8.5V5.75" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5.75c-1.1-.8-1.05-2.05 0-3.25 1.05 1.2 1.1 2.45 0 3.25ZM5 15c1.2 1.1 2.3 1.1 3.5 0 1.2 1.1 2.3 1.1 3.5 0 1.2 1.1 2.3 1.1 3.5 0 1.2 1.1 2.3 1.1 3.5 0" />
    </svg>
  );
}

function formatBirthday(birthday: string): string {
  const [, month, day] = birthday.split("-").map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

function daysUntilBirthday(birthday: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [, month, day] = birthday.split("-").map(Number);
  const next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}

export default function BirthdayCalendar({ employees }: { employees: EmployeeStub[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const withBirthdays = employees.filter((employee) => employee.birthday);

  const birthdayMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const employee of withBirthdays) {
      const key = employee.birthday!.slice(5);
      const names = map.get(key) ?? [];
      names.push(employee.name);
      map.set(key, names);
    }
    return map;
  }, [withBirthdays]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const previousMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((current) => current - 1);
    } else {
      setMonth((current) => current - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((current) => current + 1);
    } else {
      setMonth((current) => current + 1);
    }
  };

  const returnToToday = () => {
    const current = new Date();
    setYear(current.getFullYear());
    setMonth(current.getMonth());
  };

  const upcoming = useMemo(
    () =>
      withBirthdays
        .map((employee) => ({ ...employee, daysUntil: daysUntilBirthday(employee.birthday!) }))
        .filter((employee) => employee.daysUntil <= 60)
        .sort((a, b) => a.daysUntil - b.daysUntil),
    [withBirthdays],
  );

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <CakeIcon />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-950">Team celebrations</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">See upcoming birthdays and plan a thoughtful moment for the team.</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center">
          <span className="block text-lg font-semibold text-slate-900">{withBirthdays.length}</span>
          <span className="block text-[11px] text-slate-400">birthdays on file</span>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Birthday calendar">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-slate-900">{monthLabel}</p>
              <button type="button" onClick={returnToToday} className="mt-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-700">
                Return to this month
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={previousMonth} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button type="button" onClick={nextMonth} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <span className="sm:hidden">{day.slice(0, 1)}</span>
                <span className="hidden sm:inline">{day}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="h-16 border-b border-r border-slate-100/80 bg-slate-50/30 sm:h-20" />;

              const key = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const names = birthdayMap.get(key) ?? [];
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

              return (
                <div key={day} className={`group relative h-16 border-b border-r border-slate-100/80 p-1.5 sm:h-20 sm:p-2 ${names.length > 0 ? "bg-amber-50/60" : "bg-white"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${isToday ? "bg-blue-600 text-white" : names.length > 0 ? "text-amber-700" : "text-slate-400"}`}>
                    {day}
                  </span>
                  {names.length > 0 && (
                    <div className="mt-1">
                      <span className="block truncate text-[9px] font-semibold leading-tight text-amber-700 sm:text-[10px]">
                        {names[0]}{names.length > 1 ? ` +${names.length - 1}` : ""}
                      </span>
                      <div className="absolute bottom-[calc(100%-4px)] left-1 z-20 hidden rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                        <span className="whitespace-nowrap">{names.join(", ")}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Coming up</h3>
            <p className="mt-0.5 text-xs text-slate-400">Next 60 days</p>
          </div>
          {upcoming.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {upcoming.map((employee) => (
                <div key={employee.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-[11px] font-semibold text-amber-700" aria-hidden="true">
                    {initials(employee.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{employee.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{formatBirthday(employee.birthday!)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${employee.daysUntil === 0 ? "bg-amber-100 text-amber-700" : employee.daysUntil <= 7 ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
                    {employee.daysUntil === 0 ? "Today" : employee.daysUntil === 1 ? "Tomorrow" : `${employee.daysUntil} days`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <CakeIcon />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-600">No birthdays coming up</p>
              <p className="mt-1 text-xs text-slate-400">The next 60 days are clear.</p>
            </div>
          )}
        </section>
      </div>

      {withBirthdays.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
          Add birthdays to employee profiles to see celebrations here.
        </p>
      )}
    </div>
  );
}
