import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { isManagementUserMock, isRestrictedSurveyManagerMock, loadReportMock, sendSurveysMock } = vi.hoisted(() => ({
  isManagementUserMock: vi.fn(),
  isRestrictedSurveyManagerMock: vi.fn(),
  loadReportMock: vi.fn(),
  sendSurveysMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ email: "manager@example.com" }),
  isManagementUser: isManagementUserMock,
  isRestrictedSurveyManager: isRestrictedSurveyManagerMock,
}));
vi.mock("@/lib/survey-reporting", () => ({ loadSurveyDashboardReport: loadReportMock }));
vi.mock("@/lib/employee-surveys", () => ({
  sendSurveys: sendSurveysMock,
  createTargetedSurveyCampaign: vi.fn(),
}));

import { GET, POST } from "@/app/api/kpi/employees/surveys/route";

beforeEach(() => {
  vi.clearAllMocks();
  isRestrictedSurveyManagerMock.mockResolvedValue(false);
  loadReportMock.mockResolvedValue({ campaigns: [], restrictedCampaigns: [] });
  sendSurveysMock.mockResolvedValue({ sent: 3, skipped: 1, errors: [] });
});

describe("employee survey management authorization", () => {
  it("denies result access to an authenticated non-manager", async () => {
    isManagementUserMock.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(loadReportMock).not.toHaveBeenCalled();
  });

  it("passes restricted-exit access separately from ordinary management", async () => {
    isManagementUserMock.mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(loadReportMock).toHaveBeenCalledWith(false);
  });

  it("also denies survey sends to non-management users", async () => {
    isManagementUserMock.mockResolvedValue(false);
    const response = await POST(new NextRequest("https://tools.example/api/kpi/employees/surveys?action=send", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(sendSurveysMock).not.toHaveBeenCalled();
  });
});
