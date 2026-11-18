import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { rankIrsSources, searchIrs } from "@/lib/irs-sources.server";
import { identifyTaxTopics } from "@/lib/tax-topics";

const Q = "I'm 20 years old, single, have no dependents of my own, and my parents are claiming me as a dependent. I expect to earn $10,000 for the entire 2026 tax year from W-2 employment. I have no other income and no federal income tax withholding. Do I need to file a federal income tax return?";
const P4012 = "https://www.irs.gov/pub/irs-pdf/p4012.pdf";

function pdfWith(pages: string[]) {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  pages.forEach((content, i) => {
    const z = deflateSync(Buffer.from(content, "latin1"));
    parts.push(Buffer.from(`${i + 1} 0 obj\r<</Filter/FlateDecode/Length ${z.length}>>stream\r\n`), z, Buffer.from("\r\nendstream\rendobj\r"));
  });
  return new Uint8Array(Buffer.concat(parts));
}
// "Your earned income" in 2-byte glyph IDs (glyph + 29 = ASCII), as embedded in the IRS PDF.
const hex = (s: string) => [...s].map((c) => (c.charCodeAt(0) - 29).toString(16).padStart(4, "0")).join("");

describe("2026 dependent filing requirement retrieval (Pub 4012 Chart B)", () => {
  it("routes the dependent filing question and its phrasings to Publication 4012", () => {
    expect(identifyTaxTopics(Q)).toContain("dependents");
    for (const q of [Q, "dependent filing requirements", "2026 filing threshold for a dependent", "W-2 wages earned income unearned income dependent must file"]) {
      expect(rankIrsSources(q).some((r) => r.source.url === P4012)).toBe(true);
    }
  });
  it("extracts all three single-dependent tests from the live-style PDF, including embedded-font text", async () => {
    const pdf = pdfWith([
      "BT (Table of Contents Chart B \\226 For Children and Other Dependents 3)Tj ET",
      "BT (AND at the end of 2026 you were)Tj ET",
      `BT (Chart B \\226 For Children and Other Dependents)Tj ET BT (Under 65 and not blind)Tj ET BT (You must file a return if any of the following apply)Tj ET BT (1. Your unearned income was over $1,350.)Tj ET BT [<${hex("2. Your earned income")}>]TJ ET BT ( was over $16,100.)Tj ET BT (3. Your gross income was more than the larger of \\227 a. $1,350, or b. Your earned income \\(up to $15,650\\) plus $450.)Tj ET`,
      "BT (Later page that must never be downloaded)Tj ET",
    ]);
    const r = await searchIrs(Q, async () => new Response(pdf));
    const hit = r.results.find((x) => x.url === P4012);
    expect(hit?.excerpt).toContain("AND at the end of 2026");
    expect(hit?.excerpt).toContain("unearned income was over $1,350");
    expect(hit?.excerpt).toContain("2. Your earned income was over $16,100");
    expect(hit?.excerpt).toContain("larger of — a. $1,350, or b. Your earned income (up to $15,650) plus $450");
    expect(hit?.excerpt).not.toContain("Later page");
  });
  it("reports a failure instead of evidence when Chart B is absent", async () => {
    const r = await searchIrs(Q, async () => new Response(pdfWith(["BT (Unrelated page)Tj ET"])));
    expect(r.results.some((x) => x.url === P4012)).toBe(false);
    expect(r.errors.some((e) => e.includes("p4012.pdf") && e.includes("not found"))).toBe(true);
  });
});
