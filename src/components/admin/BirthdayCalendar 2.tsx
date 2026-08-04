"use client";

import { useState, useMemo } from "react";

interface EmployeeStub {
  id: string;
  name: string;
  birthday: string | null;
}

function formatBirthday(birthday: string): string {
  // birthday is "YYYY-MM-DD" — parse as local date ignoring year
  const [, month, day] = birthday.split("-").map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function daysUntilBirthday(birthday: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [, month, day] = birthday.split("-").map(Number);
  const next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export default function BirthdayCalendar({ employees }: { employees: EmployeeStub[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const withBirthdays = employees.filter((e) => e.birthday);

  // Map from "MM-DD" to employee names
  const birthdayMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const emp of withBirthdays) {
      const key = emp.birthday!.slice(5); // "MM-DD"
      const list = map.get(key) ?? [];
      list.push(emp.name);
      map.set(key, list);
    }
    return map;
  }, [withBirthdays]);

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Start week on Monday: shift Sunday (0) to position 6
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Upcoming birthdays (next 60 days)
  const upcoming = useMemo(() => {
    return withBirthdays
      .map((e) => ({ ...e, daysUntil: daysUntilBirthday(e.birthday!) }))
      .filter((e) => e.daysUntil <= 60)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [withBirthdays]);

  return (
    <div className="space-y-6">
      {/* Calendar */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sand-100">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-sand-100 text-sand-500 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-sand-900">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-sand-100 text-sand-500 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-sand-100">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="py-2 text-center text-[11px] font-medium text-sand-400 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="h-14 border-b border-r border-sand-50/80" />;

            const key = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const names = birthdayMap.get(key) ?? [];
            const isToday =
              day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

            return (
              <div
                key={day}
                className={`h-14 border-b border-r border-sand-50/80 p-1.5 relative ${names.length > 0 ? "bg-amber-50" : ""}`}
              >
                <span
                  className={`text-xs font-medium ${isToday ? "bg-sand-900 text-white w-5 h-5 rounded-full flex items-center justify-center" : names.length > 0 ? "text-amber-700" : "text-sand-400"}`}
                >
                  {day}
                </span>
                {names.length > 0 && (
                  <div className="mt-0.5 group relative">
                    <span className="text-[10px] text-amber-600 leading-tight block truncate">
                      🎂 {names[0]}{names.length > 1 ? ` +${names.length - 1}` : ""}
                    </span>
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 bg-sand-900 text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap shadow-lg">
                      {names.join(", ")}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming birthdays list */}
      {upcoming.length > 0 ? (
        <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-sand-100">
            <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Upcoming — Next 60 Days</h3>
          </div>
          <div className="divide-y divide-sand-50">
            {upcoming.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">🎂</span>
                  <div>
                    <p className="text-sm font-medium text-sand-900">{emp.name}</p>
                    <p className="text-xs text-sand-400">{formatBirthday(emp.birthday!)}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  emp.daysUntil === 0 ? "bg-amber-100 text-amber-700" :
                  emp.daysUntil <= 7 ? "bg-orange-50 text-orange-600" : "bg-sand-100 text-sand-500"
                }`}>
                  {emp.daysUntil === 0 ? "Today! 🎉" : emp.daysUntil === 1 ? "Tomorrow" : `In ${emp.daysUntil} days`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-sand-200/60 px-5 py-8 text-center text-sm text-sand-400">
          No birthdays in the next 60 days.
        </div>
      )}

      {withBirthdays.length === 0 && (
        <p className="text-sm text-sand-400 text-center">
          Add birthdays to employee profiles to see them here.
        </p>
      )}
    </div>
  );
}
