import { describe, it, expect } from "vitest";
import { IRS_CATALOG, rankIrsSources, searchIrs } from "@/lib/irs-sources.server";
import { identifyTaxTopics, TAX_TOPICS } from "@/lib/tax-topics";

const cases = [
  ["filing_status", "What are the five filing statuses?", "/filing/filing-status"],
  ["dependents", "What are the qualifying child and qualifying relative dependent tests?", "/dependents"],
  ["income", "Is unemployment compensation taxable income?", "/unemployment-compensation"],
  ["deductions", "How do itemized deductions on Schedule A compare to the standard deduction?", "/i1040sca"],
  ["credits", "How do American Opportunity and Lifetime Learning education credits differ?", "/education-credits-aotc-and-llc"],
  ["investments", "Explain capital loss limitations and carryforwards", "/i1040sd"],
] as const;

describe("categorized official IRS retrieval", () => {
  it("retains all previous sources and covers all six categories with unique official URLs", () => {
    expect(IRS_CATALOG).toHaveLength(28);
    expect(new Set(IRS_CATALOG.map((s) => s.url)).size).toBe(28);
    for (const topic of TAX_TOPICS) expect(IRS_CATALOG.some((s) => s.categories.includes(topic))).toBe(true);
    for (const s of IRS_CATALOG) expect(new URL(s.url).origin).toBe("https://www.irs.gov");
    for (const slug of ["tc409", "p550", "p544", "p551", "tc701", "tc559", "tc404", "tc703", "digital-assets", "tc501", "tc751", "tc451"]) {
      expect(IRS_CATALOG.some((s) => s.url.endsWith(slug))).toBe(true);
    }
  });
  it.each(cases)("routes %s questions to relevant live-fetched sources", async (topic, question, slug) => {
    expect(identifyTaxTopics(question)).toContain(topic);
    const ranked = rankIrsSources(question);
    expect(ranked.some((r) => r.source.url.endsWith(slug))).toBe(true);
    const fetched: string[] = [];
    const r = await searchIrs(question, async (url) => {
      fetched.push(String(url));
      return new Response(`<main><p>${question} Live evidence marker 4821 with relevant requirements and limitations.</p></main>`);
    });
    expect(r.results.length).toBeGreaterThan(0);
    expect(fetched).toEqual(ranked.map((r) => r.source.url));
    expect(r.results.every((s) => s.excerpt.includes("4821"))).toBe(true);
    expect(r.results.every((s) => s.categories.some((t) => identifyTaxTopics(question).includes(t)))).toBe(true);
  });
  it("does not retrieve unrelated pages based on generic tax words", async () => {
    let calls = 0;
    const r = await searchIrs("Explain the federal tax rules for Martian teleportation permits", async () => { calls++; return new Response(""); });
    expect(r.results).toEqual([]);
    expect(calls).toBe(0);
  });
  it("records real HTTP failures without substituting catalog text as evidence", async () => {
    const r = await searchIrs("filing status", async () => new Response("unavailable", { status: 503 }));
    expect(r.results).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.includes("HTTP 503"))).toBe(true);
  });
  it("excludes investment publications from a focused filing-status question", () => {
    expect(rankIrsSources("Can I use head of household filing status?").every((r) => r.source.categories.includes("filing_status"))).toBe(true);
  });
  it("excludes unrelated credits from a focused education-credit question", () => {
    const ranked = rankIrsSources("American Opportunity Tax Credit Lifetime Learning Credit education tuition enrollment");
    expect(ranked.some((r) => r.source.url.endsWith("education-credits-aotc-and-llc"))).toBe(true);
    expect(ranked.some((r) => r.source.url.endsWith("adoption-credit"))).toBe(false);
  });
});