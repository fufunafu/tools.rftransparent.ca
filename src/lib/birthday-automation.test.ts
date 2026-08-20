import { describe, expect, it } from "vitest";
import {
  birthdayMatchesDate,
  createBirthdayMessagePlan,
  isBirthdayDispatchHour,
  torontoBirthdayDateKey,
  type BirthdayEmployee,
} from "@/lib/birthday-automation";

const employees: BirthdayEmployee[] = [
  { id: "alex", name: "Alex", phone: "+14165550001", birthday: "1990-08-14" },
  { id: "sam", name: "Sam", phone: "+14165550002", birthday: "1992-05-10" },
  { id: "jo", name: "Jo", phone: "+14165550003", birthday: null },
];

describe("birthday scheduling", () => {
  it("uses the Toronto calendar date and 9 AM dispatch hour", () => {
    expect(torontoBirthdayDateKey(new Date("2026-08-14T03:30:00Z"))).toBe("2026-08-13");
    expect(isBirthdayDispatchHour(new Date("2026-08-14T13:35:00Z"))).toBe(true);
    expect(isBirthdayDispatchHour(new Date("2026-01-14T14:35:00Z"))).toBe(true);
    expect(isBirthdayDispatchHour(new Date("2026-08-14T14:35:00Z"))).toBe(false);
  });

  it("celebrates February 29 birthdays on February 28 in non-leap years", () => {
    expect(birthdayMatchesDate("1992-02-29", "2026-02-28")).toBe(true);
    expect(birthdayMatchesDate("1992-02-29", "2028-02-28")).toBe(false);
    expect(birthdayMatchesDate("1992-02-29", "2028-02-29")).toBe(true);
  });
});

describe("birthday message planning", () => {
  it("greets the birthday employee and reminds every other active employee", () => {
    const plan = createBirthdayMessagePlan(employees, "2026-08-14");
    expect(plan).toHaveLength(3);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "greeting", birthdayEmployee: employees[0], recipient: employees[0] }),
      expect.objectContaining({ kind: "coworker_reminder", birthdayEmployee: employees[0], recipient: employees[1] }),
      expect.objectContaining({ kind: "coworker_reminder", birthdayEmployee: employees[0], recipient: employees[2] }),
    ]));
    expect(plan.some((item) => item.kind === "coworker_reminder" && item.recipient.id === "alex")).toBe(false);
  });
});
