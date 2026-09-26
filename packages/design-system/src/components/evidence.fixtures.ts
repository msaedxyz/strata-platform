import type { Evidence } from "./Provenance";

// Sample evidence for stories and tests. The text is invented and neutral.
export const sampleEvidence: Evidence[] = [
  {
    id: "ev_01",
    before: "The company said on Monday that ",
    quote: "the environmental impact statement for the plant expansion was filed with the agency",
    after: " and that a decision is expected next year.",
    sourceUrl: "https://example.com/news/plant-expansion",
    sourceTitle: "Plant expansion moves to assessment",
    publisher: "Example News",
    publishedAt: "12 Sep 2026",
  },
  {
    id: "ev_02",
    quote: "Construction is planned to start in the second quarter of 2027.",
    sourceUrl: "https://example.com/filings/q3",
    publisher: "Company filing",
    publishedAt: "20 Sep 2026",
  },
];
