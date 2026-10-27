// Normalize explicit country spellings without inferring a missing location.
// The original imported properties remain unchanged.
const countries = {
  ca: "Canada", can: "Canada", canada: "Canada",
  us: "United States", usa: "United States", "u.s.": "United States", "u.s.a.": "United States",
  "united states": "United States", "united states of america": "United States",
  uk: "United Kingdom", gb: "United Kingdom", "united kingdom": "United Kingdom",
  nl: "Netherlands", netherlands: "Netherlands", china: "China", india: "India",
};
const clean = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : "";
const regions = {
  Canada: { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon" },
  "United States": { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" },
};
export function projectCrmLocation(properties) {
  const rawCountry = clean(properties.country) || clean(properties.hs_country_region_code);
  const country = countries[rawCountry.toLowerCase()] || rawCountry;
  const rawRegion = clean(properties.state) || clean(properties.hs_state_code);
  const choices = regions[country];
  const region = choices?.[rawRegion.toUpperCase()] || (choices && Object.values(choices).find(value => value.toLowerCase() === rawRegion.toLowerCase())) || rawRegion;
  return {
    country, region,
    city: clean(properties.city),
  };
}
