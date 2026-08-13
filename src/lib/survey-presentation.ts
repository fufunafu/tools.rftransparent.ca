export const SURVEY_RATING_OPTIONS = [
  { value: 1, label: "Very low", symbol: "★" },
  { value: 2, label: "Could improve", symbol: "★" },
  { value: 3, label: "Okay", symbol: "★" },
  { value: 4, label: "Good", symbol: "★" },
  { value: 5, label: "Great", symbol: "★" },
] as const;

export function formatSurveyWeek(weekOf: string): string {
  return new Date(`${weekOf}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
