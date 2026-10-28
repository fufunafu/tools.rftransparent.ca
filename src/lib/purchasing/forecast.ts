import { getPurchasingPlanning } from "./queries";
export { buildForecast } from "./planning";

export async function getInventoryForecasts() {
  return (await getPurchasingPlanning()).forecasts;
}
