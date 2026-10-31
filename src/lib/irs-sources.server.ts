import { identifyTaxTopics, type TaxTopic } from "./tax-topics";

type IrsSource = { title: string; url: string; categories: TaxTopic[]; keywords: string };
// Curated URLs are routing metadata, never tax evidence; excerpts come from live IRS responses.
export const IRS_CATALOG: IrsSource[] = [
  { title: "Topic No. 409, Capital Gains and Losses", url: "https://www.irs.gov/taxtopics/tc409", categories: ["investments"], keywords: "capital gain loss stock sell sale holding period long-term short-term rate net investment asset" },
  { title: "Publication 550, Investment Income and Expenses", url: "https://www.irs.gov/publications/p550", categories: ["investments"], keywords: "investment income dividend interest stock bond holding period wash sale capital gain basis" },
  { title: "Publication 544, Sales and Other Dispositions of Assets", url: "https://www.irs.gov/publications/p544", categories: ["investments"], keywords: "sale disposition asset property capital gain holding period exchange" },
  { title: "Publication 551, Basis of Assets", url: "https://www.irs.gov/publications/p551", categories: ["investments"], keywords: "basis cost asset inherited gift adjusted basis stock" },
  { title: "Topic No. 701, Sale of Your Home", url: "https://www.irs.gov/taxtopics/tc701", categories: ["investments"], keywords: "home house residence sale exclusion 250000 500000 main home" },
  { title: "Topic No. 559, Net Investment Income Tax", url: "https://www.irs.gov/taxtopics/tc559", categories: ["investments"], keywords: "net investment income tax niit 3.8 percent" },
  { title: "Topic No. 404, Dividends", url: "https://www.irs.gov/taxtopics/tc404", categories: ["investments"], keywords: "dividend qualified ordinary distribution" },
  { title: "Topic No. 703, Basis of Assets", url: "https://www.irs.gov/taxtopics/tc703", categories: ["investments"], keywords: "basis cost asset" },
  { title: "Digital assets", url: "https://www.irs.gov/filing/digital-assets", categories: ["investments"], keywords: "crypto cryptocurrency bitcoin digital asset nft virtual currency" },
  { title: "Topic No. 501, Should I Itemize?", url: "https://www.irs.gov/taxtopics/tc501", categories: ["deductions"], keywords: "itemize standard deduction schedule a" },
  { title: "Topic No. 751, Social Security and Medicare Withholding Rates", url: "https://www.irs.gov/taxtopics/tc751", categories: ["income"], keywords: "social security medicare withholding fica" },
  { title: "Topic No. 451, Individual Retirement Arrangements (IRAs)", url: "https://www.irs.gov/taxtopics/tc451", categories: ["income"], keywords: "ira retirement roth traditional contribution" },
  { title: "Filing status", url: "https://www.irs.gov/filing/filing-status", categories: ["filing_status"], keywords: "filing status single married jointly separately head household qualifying surviving spouse widow widower" },
  { title: "Dependents", url: "https://www.irs.gov/credits-deductions/individuals/dependents", categories: ["dependents"], keywords: "dependents qualifying child relative relationship residency age student support income tests" },
  { title: "Publication 501, Dependents, Standard Deduction, and Filing Information", url: "https://www.irs.gov/publications/p501", categories: ["filing_status", "dependents", "deductions"], keywords: "filing status dependents qualifying child relative standard deduction household surviving spouse" },
  { title: "Topic No. 401, Wages and Salaries", url: "https://www.irs.gov/taxtopics/tc401", categories: ["income"], keywords: "wages salaries salary w2 w-2 compensation employer" },
  { title: "Topic No. 403, Interest Received", url: "https://www.irs.gov/taxtopics/tc403", categories: ["income"], keywords: "interest bank savings taxable nontaxable bond" },
  { title: "Unemployment compensation", url: "https://www.irs.gov/individuals/employees/unemployment-compensation", categories: ["income"], keywords: "unemployment compensation benefits taxable" },
  { title: "Taxable income", url: "https://www.irs.gov/filing/taxable-income", categories: ["income"], keywords: "taxable nontaxable income gross gifts inheritance" },
  { title: "Publication 525, Taxable and Nontaxable Income", url: "https://www.irs.gov/publications/p525", categories: ["income"], keywords: "taxable nontaxable income wages unemployment gifts benefits" },
  { title: "Adjusted gross income", url: "https://www.irs.gov/filing/adjusted-gross-income", categories: ["income"], keywords: "adjusted gross income agi adjustments" },
  { title: "Instructions for Schedule A (Form 1040)", url: "https://www.irs.gov/instructions/i1040sca", categories: ["deductions"], keywords: "itemized deductions schedule a medical dental taxes salt mortgage interest charitable contributions limits" },
  { title: "Publication 502, Medical and Dental Expenses", url: "https://www.irs.gov/publications/p502", categories: ["deductions"], keywords: "medical dental expenses deduction adjusted gross income" },
  { title: "Child Tax Credit", url: "https://www.irs.gov/credits-deductions/individuals/child-tax-credit", categories: ["credits"], keywords: "child tax credit ctc additional other dependents age residency income qualifying" },
  { title: "Earned Income Tax Credit (EITC)", url: "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit-eitc", categories: ["credits"], keywords: "earned income tax credit eitc eic qualifying child income eligibility" },
  { title: "Education credits - AOTC and LLC", url: "https://www.irs.gov/credits-deductions/individuals/education-credits-aotc-and-llc", categories: ["credits"], keywords: "education credits american opportunity aotc lifetime learning llc tuition student enrollment expenses" },
  { title: "Adoption Credit", url: "https://www.irs.gov/credits-deductions/individuals/adoption-credit", categories: ["credits"], keywords: "adoption credit qualified expenses child" },
  { title: "Instructions for Schedule D (Form 1040)", url: "https://www.irs.gov/instructions/i1040sd", categories: ["investments"], keywords: "capital gains losses loss limitation carryforward carryforwards schedule d net short-term long-term" },
];

function strip(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set("the a an is are was were be been i me my we our you your it this that of to for from on in at as and or but if how what when which can could should would do does did have has with about tax taxes federal personal individual please tell explain generally general".split(" "));
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const terms = (s: string) => tokens(s).filter((t) => t.length > 1 && !STOP_WORDS.has(t));

export function rankIrsSources(query: string) {
  const topics = identifyTaxTopics(query);
  if (!topics.length) return [];
  const q = new Set(terms(query));
  const ranked = IRS_CATALOG.filter((source) => source.categories.some((topic) => topics.includes(topic)))
    .map((source) => {
      const keywords = new Set(terms(source.keywords));
      const title = new Set(terms(source.title));
      const score = [...q].reduce((sum, term) => sum + (keywords.has(term) ? 2 : 0) + (title.has(term) ? 3 : 0), 0);
      return { source, score };
    })
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  return ranked.filter((r) => r.score >= Math.max(2, best * 0.45)).slice(0, 3);
}

export async function searchIrs(query: string, fetchPage: typeof fetch = fetch) {
  const q = new Set(terms(query));
  const ranked = rankIrsSources(query);
  const results: { title: string; url: string; categories: TaxTopic[]; excerpt: string }[] = [];
  const errors: string[] = [];
  await Promise.all(ranked.map(async ({ source: s }) => {
    try {
      const res = await fetchPage(s.url, { headers: { "User-Agent": "TaxWiseAI-student-project/1.0" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { errors.push(`${s.url}: HTTP ${res.status}`); return; }
      if (new URL(res.url || s.url).hostname !== "www.irs.gov" && new URL(res.url || s.url).hostname !== "irs.gov") {
        errors.push(`${s.url}: non-IRS redirect rejected`); return;
      }
      const html = await res.text();
      // Keep page/year context and whole nearby blocks so lists of eligibility tests survive extraction.
      const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
      const text = strip(main);
      const blocks = text.match(/[\s\S]{1,700}(?:\s|$)/g) ?? [];
      const top = blocks.map((x, i) => ({ x, i, score: terms(x).filter((t) => q.has(t)).length }))
        .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
      const indexes = new Set(top.flatMap((r) => [r.i, r.i + 1]).filter((i) => i < blocks.length));
      const excerpt = [text.slice(0, 700), ...[...indexes].sort((a, b) => a - b).map((i) => blocks[i])].join(" ").slice(0, 8000);
      if (top.length) results.push({ title: s.title, url: s.url, categories: s.categories, excerpt });
      else errors.push(`${s.url}: no relevant passages found`);
    } catch (e) {
      errors.push(`${s.url}: ${e instanceof Error ? e.message : "retrieval failed"}`);
    }
  }));
  // Network timing does not determine source order.
  results.sort((a, b) => ranked.findIndex((r) => r.source.url === a.url) - ranked.findIndex((r) => r.source.url === b.url));
  return { results, errors };
}
