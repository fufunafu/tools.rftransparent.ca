import type { LeadSource } from "@/lib/customer-service/leads";

export const LEAD_SPAM_REASON = "Spam: marketing solicitation";

export type LeadSpamCategory =
  | "search-engine-optimization"
  | "google-ranking"
  | "link-building"
  | "guest-post"
  | "marketing-solicitation";

export interface LeadSpamAssessment {
  isSpam: boolean;
  category: LeadSpamCategory | null;
}

interface LeadSpamInput {
  source: LeadSource;
  name?: string | null;
  email?: string | null;
  message?: string | null;
}

const STRONG_MARKETING_PATTERNS: Array<{
  category: Exclude<LeadSpamCategory, "marketing-solicitation">;
  pattern: RegExp;
}> = [
  {
    category: "search-engine-optimization",
    pattern: /\bsearch engine optimi[sz]ation\b/i,
  },
  {
    category: "google-ranking",
    pattern: /(?:\b(?:rank|ranking|first page|top page|position)\b.{0,40}\b(?:google|search engine)\b)|(?:\b(?:google|search engine)\b.{0,40}\b(?:rank|ranking|first page|top page|position)\b)/i,
  },
  {
    category: "link-building",
    pattern: /\b(?:backlinks?|link[ -]?building|domain authority)\b/i,
  },
  {
    category: "guest-post",
    pattern: /\b(?:guest|sponsored) posts?\b|\bpublish (?:an? )?article\b/i,
  },
];

const MARKETING_SERVICE_PATTERN = /\b(?:seo|digital marketing|online marketing|internet marketing|social media marketing|web(?:site)? (?:design|redesign|development))\b|\b(?:increase|boost|drive)\b.{0,30}\b(?:website |web )?traffic\b/i;

const SOLICITATION_PATTERN = /\b(?:(?:we|i) (?:can|could|would like to|want to) (?:help|offer|provide)|would you be interested|free (?:audit|analysis|report|consultation)|our services|marketing (?:agency|services?|proposal)|affordable (?:price|pricing))\b/i;

/**
 * Identify obvious third-party marketing pitches submitted through website
 * lead forms. Strong, specific phrases can stand alone. Broader terms such as
 * SEO require an explicit solicitation cue to reduce false positives.
 */
export function assessLeadSpam(input: LeadSpamInput): LeadSpamAssessment {
  if (input.source !== "website") return { isSpam: false, category: null };

  const message = input.message?.trim() ?? "";
  if (!message) return { isSpam: false, category: null };

  for (const rule of STRONG_MARKETING_PATTERNS) {
    if (rule.pattern.test(message)) {
      return { isSpam: true, category: rule.category };
    }
  }

  const searchable = [input.name, input.email, message].filter(Boolean).join("\n");
  if (MARKETING_SERVICE_PATTERN.test(searchable) && SOLICITATION_PATTERN.test(message)) {
    return { isSpam: true, category: "marketing-solicitation" };
  }

  return { isSpam: false, category: null };
}

export function isLeadSpamReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /^\s*spam\b/i.test(reason) || /^\s*(?:seo|marketing) solicitation\b/i.test(reason);
}
