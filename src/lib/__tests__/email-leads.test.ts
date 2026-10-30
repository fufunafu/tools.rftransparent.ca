import { describe, expect, it } from "vitest";
import {
  emailLeadQuery,
  leadFieldsPayload,
  parseEmailLead,
  parseJudgeMeQuestion,
  parseShopifyContactNotification,
} from "@/lib/customer-service/email-leads";
import { extractSubmissionDetails } from "@/lib/customer-service/leads";

const crlf = (lines: string[]) => lines.join("\r\n");

const quoteForm = {
  from: '"Glass Railings Supply (Shopify)" <mailer@shopify.com>',
  subject: "New customer message on October 30, 2026 at 1:42 pm",
  body: crlf([
    "You received a new message from your online store's contact form.",
    "Country Code:",
    "US",
    "Tags:",
    "quote",
    "Name:",
    "Jamie Example",
    "Email:",
    "Jamie.Example@example.com",
    "Phone:",
    "+14025550100",
    "State:",
    "Nebraska",
    "Project Zip:",
    "68339",
    "Project Type:",
    "Deck Railing",
    "Total Length:",
    "35.5",
    "Finish:",
    "",
    "Body:",
    "2 right angle corners. 3 sections.",
    "Clear glass, posts, no top rail",
  ]),
};

describe("parseShopifyContactNotification", () => {
  it("reads the glass-railings.com quote form into contact fields, details, and message", () => {
    const lead = parseShopifyContactNotification(quoteForm);
    expect(lead).toMatchObject({
      provider: "shopify_contact_form",
      sourceDetail: "Shopify contact form: Glass Railings Supply",
      storeName: "Glass Railings Supply",
      name: "Jamie Example",
      email: "jamie.example@example.com",
      phone: "+14025550100",
      message: "2 right angle corners. 3 sections.\nClear glass, posts, no top rail",
    });
    expect(lead?.fields).toEqual([
      { label: "Tags", value: "quote" },
      { label: "State", value: "Nebraska" },
      { label: "Project Zip", value: "68339" },
      { label: "Project Type", value: "Deck Railing" },
      { label: "Total Length", value: "35.5" },
    ]);
  });

  it("names the store from the sender and labels the generic topic field", () => {
    const lead = parseShopifyContactNotification({
      from: '"Glass Fence Direct (Shopify)" <mailer@shopify.com>',
      subject: "New customer message on October 1, 2026 at 2:48 am",
      body: crlf([
        "You received a new message from your online store's contact form.",
        "Name:",
        "Robin Sample",
        "Email:",
        "robin@example.com",
        "Phone:",
        "",
        "New customer message on %{creation_date}:",
        "Product Question",
        "Body:",
        "I need a glass gate for a 50 inch opening.",
      ]),
    });
    expect(lead?.sourceDetail).toBe("Shopify contact form: Glass Fence Direct");
    expect(lead?.phone).toBeNull();
    expect(lead?.fields).toEqual([{ label: "Topic", value: "Product Question" }]);
    expect(lead?.message).toBe("I need a glass gate for a 50 inch opening.");
  });

  it("ignores other Shopify mail such as order notifications", () => {
    expect(
      parseShopifyContactNotification({
        from: '"The Glass Railing Store" <mailer@shopify.com>',
        subject: "[The Glass Railing Store] Order #1001 placed by Jamie Example",
        body: "Order summary",
      }),
    ).toBeNull();
  });
});

describe("parseJudgeMeQuestion", () => {
  it("reads the product, question, and asker email", () => {
    const lead = parseJudgeMeQuestion({
      from: "Judge.me <support@judge.me>",
      subject: 'New question for product 39.6" High Tempered Glass Panels 12mm',
      body: [
        ' You have received a new question for your product 39.6" High Tempered Glass Panels 12mm.',
        " Question: ",
        " What size would the 2 panels be to span 88 inches? ",
        " Click here to ask recent buyers or answer yourself .",
        " P.S. You can contact the reviewer via asker@example.com.",
        " Kind regards,",
      ].join("\n"),
    });
    expect(lead).toMatchObject({
      provider: "judgeme_question",
      sourceDetail: "Judge.me product question",
      email: "asker@example.com",
      message: 'Question about 39.6" High Tempered Glass Panels 12mm: What size would the 2 panels be to span 88 inches?',
      fields: [{ label: "Product", value: '39.6" High Tempered Glass Panels 12mm' }],
    });
  });

  it("ignores Judge.me review and marketing emails", () => {
    expect(
      parseJudgeMeQuestion({ from: "Judge.me <support@judge.me>", subject: "Jamie left a 5 star review", body: "" }),
    ).toBeNull();
  });
});

describe("parseEmailLead", () => {
  it("routes each notification to the right parser", () => {
    expect(parseEmailLead(quoteForm)?.provider).toBe("shopify_contact_form");
    expect(parseEmailLead({ from: "someone@example.com", subject: "Hello", body: "Hi" })).toBeNull();
  });
});

describe("leadFieldsPayload", () => {
  it("renders on the Leads page like other form submissions, keeping repeated labels", () => {
    const fields = leadFieldsPayload([
      { label: "Project Type", value: "Deck Railing" },
      { label: "Selected Variant", value: "matte-black / 36\"" },
      { label: "Selected Variant", value: "46107557953708" },
    ]);
    expect(extractSubmissionDetails({ fields })).toEqual([
      { key: "project_type", label: "Project Type", value: "Deck Railing" },
      { key: "selected_variant", label: "Selected Variant", value: "matte-black / 36\"" },
      { key: "selected_variant_2", label: "Selected Variant", value: "46107557953708" },
    ]);
  });
});

describe("emailLeadQuery", () => {
  it("searches both notification types within the lookback window", () => {
    expect(emailLeadQuery(3)).toBe(
      '((from:mailer@shopify.com subject:"New customer message") OR (from:judge.me subject:"New question for product")) newer_than:3d',
    );
  });
});
