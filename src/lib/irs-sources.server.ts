// Curated catalog of official IRS.gov pages. The retrieval tool ranks these by
// keyword overlap, then fetches the live page and extracts relevant passages.
export const IRS_CATALOG = [
  { title: "Topic No. 409, Capital Gains and Losses", url: "https://www.irs.gov/taxtopics/tc409", keywords: "capital gain loss stock sell sale holding period long-term short-term rate net investment asset" },
  { title: "Publication 550, Investment Income and Expenses", url: "https://www.irs.gov/publications/p550", keywords: "investment income dividend interest stock bond holding period wash sale capital gain basis" },
  { title: "Publication 544, Sales and Other Dispositions of Assets", url: "https://www.irs.gov/publications/p544", keywords: "sale disposition asset property capital gain holding period exchange" },
  { title: "Publication 551, Basis of Assets", url: "https://www.irs.gov/publications/p551", keywords: "basis cost asset inherited gift adjusted basis stock" },
  { title: "Topic No. 701, Sale of Your Home", url: "https://www.irs.gov/taxtopics/tc701", keywords: "home house residence sale exclusion 250000 500000 main home" },
  { title: "Topic No. 559, Net Investment Income Tax", url: "https://www.irs.gov/taxtopics/tc559", keywords: "net investment income tax niit 3.8 percent" },
  { title: "Topic No. 404, Dividends", url: "https://www.irs.gov/taxtopics/tc404", keywords: "dividend qualified ordinary distribution" },
  { title: "Topic No. 703, Basis of Assets", url: "https://www.irs.gov/taxtopics/tc703", keywords: "basis cost asset" },
  { title: "Digital assets", url: "https://www.irs.gov/filing/digital-assets", keywords: "crypto cryptocurrency bitcoin digital asset nft virtual currency" },
  { title: "Topic No. 501, Should I Itemize?", url: "https://www.irs.gov/taxtopics/tc501", keywords: "itemize standard deduction schedule a" },
  { title: "Topic No. 751, Social Security and Medicare Withholding Rates", url: "https://www.irs.gov/taxtopics/tc751", keywords: "social security medicare withholding fica" },
  { title: "Topic No. 451, Individual Retirement Arrangements (IRAs)", url: "https://www.irs.gov/taxtopics/tc451", keywords: "ira retirement roth traditional contribution" },
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

const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9.]+/g) ?? [];

export async function searchIrs(query: string) {
  const q = new Set(tokens(query).filter((t) => t.length > 2));
  const ranked = IRS_CATALOG.map((s) => ({
    s,
    score: tokens(s.keywords + " " + s.title).filter((t) => q.has(t)).length,
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  const results = [];
  const errors: string[] = [];
  for (const { s } of ranked) {
    try {
      const res = await fetch(s.url, { headers: { "User-Agent": "TaxWiseAI-student-project/1.0" } });
      if (!res.ok) { errors.push(`${s.url}: HTTP ${res.status}`); continue; }
      const text = strip(await res.text());
      // Pick sentences with highest query-term overlap.
      const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.length > 40 && x.length < 600);
      const top = sentences
        .map((x, i) => ({ x, i, sc: tokens(x).filter((t) => q.has(t)).length }))
        .filter((r) => r.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 8)
        .sort((a, b) => a.i - b.i)
        .map((r) => r.x);
      if (top.length) results.push({ title: s.title, url: s.url, excerpt: top.join(" ").slice(0, 3000) });
    } catch (e) {
      errors.push(`${s.url}: ${(e as Error).message}`);
    }
  }
  return { results, errors };
}
