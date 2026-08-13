import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getSupabase: vi.fn() }));

import { buildSurveyDashboardReport } from "@/lib/survey-reporting";

const question = {
  id: "q1",
  metric_key: "weekly_overall",
  prompt: "How was your work week overall?",
  response_type: "scale" as const,
  options: [{ value: 1, label: "Very difficult" }, { value: 5, label: "Great" }],
  dimension: "experience",
  required: true,
  display_order: 1,
};

describe("buildSurveyDashboardReport", () => {
  it("keeps quarterly answers anonymous and suppresses groups with fewer than five responses", () => {
    const responses = Array.from({ length: 4 }, (_, index) => ({
      id: `r${index}`,
      campaign_id: "quarterly",
      recipient_id: null,
      employee_id: null,
      department_snapshot: "Sales",
      location_name_snapshot: "Toronto",
      identity_mode: "confidential_aggregate" as const,
      submitted_at: "2026-07-02T20:00:00Z",
    }));
    const report = buildSurveyDashboardReport({
      campaigns: [{ id: "quarterly", name: "Quarterly", survey_type: "quarterly", privacy_model: "confidential_aggregate", status: "closed", send_at: "2026-07-02T19:00:00Z", closes_at: null, min_group_size: 5, question_snapshot: [question] }],
      recipients: responses.map((_, index) => ({ id: `invite${index}`, campaign_id: "quarterly", employee_id: `e${index}`, employee_name: `Employee ${index}`, department_snapshot: "Sales", location_name_snapshot: "Toronto", delivery_status: "completed", sent_at: "2026-07-02T19:00:00Z", delivered_at: "2026-07-02T19:01:00Z", opened_at: "2026-07-02T19:05:00Z", completed_at: "2026-07-02T20:00:00Z" })),
      responses,
      answers: responses.map((response) => ({ response_id: response.id, metric_key: "weekly_overall", question_text_snapshot: question.prompt, response_type: "scale", numeric_value: 4, text_value: null, boolean_value: null, choice_value: null })),
      actions: [],
      canViewRestricted: false,
      now: new Date("2026-07-10T12:00:00Z"),
    });

    expect(report.campaigns[0].responses).toBeNull();
    expect(report.campaigns[0].overallSuppressed).toBe(true);
    expect(report.campaigns[0].metrics).toEqual([]);
    expect(report.campaigns[0].groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Sales", responseCount: 4, suppressed: true, metrics: null }),
    ]));
  });

  it("separates exit surveys and flags overdue actions and monthly updates", () => {
    const report = buildSurveyDashboardReport({
      campaigns: [{ id: "exit", name: "Exit", survey_type: "exit", privacy_model: "restricted_named", status: "closed", send_at: "2026-07-01T12:00:00Z", closes_at: null, min_group_size: 1, question_snapshot: [question] }],
      recipients: [], responses: [], answers: [],
      actions: [{ id: "a1", campaign_id: null, response_id: null, employee_id: null, kind: "team_action", title: "Fix process", issue: null, owner_employee_id: null, owner_name: "Manager", due_at: "2026-08-01T12:00:00Z", status: "open", acknowledged_at: null, completed_at: null, resolution: null, published_at: null, private: true, created_at: "2026-07-01T12:00:00Z" }],
      canViewRestricted: true,
      now: new Date("2026-08-13T12:00:00Z"),
    });
    expect(report.campaigns).toHaveLength(0);
    expect(report.restrictedCampaigns).toHaveLength(1);
    expect(report.alerts.map((alert) => alert.kind)).toEqual(["overdue_action"]);
  });
});
