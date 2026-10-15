import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { runTaxAgent, MAX_ITERATIONS, type AgentResult } from "@/lib/agent.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TaxWise AI — Educational Tax Research Assistant" },
      { name: "description", content: "Ask personal tax questions and get answers grounded in official IRS.gov sources, with a full agent trace." },
      { property: "og:title", content: "TaxWise AI — Educational Tax Research Assistant" },
      { property: "og:description", content: "Answers grounded in official IRS sources, with citations and an execution trace." },
    ],
  }),
  component: Index,
});

const SAMPLE = "If I sell stock after holding it for two years, is the gain long-term?";

function Index() {
  const run = useServerFn(runTaxAgent);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<AgentResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return setErr("Please enter a tax question.");
    setLoading(true); setErr(null); setRes(null);
    try {
      const r = (await run({ data: { question: q } })) as AgentResult;
      if (r.error) setErr(r.error);
      setRes(r);
    } catch (e) {
      setErr((e as Error).message || "Something went wrong.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary font-serif text-lg font-bold text-primary-foreground">T</div>
          <span className="font-serif text-xl font-bold text-primary">TaxWise <span className="text-accent">AI</span></span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-serif text-4xl font-bold text-primary">Personal tax research, grounded in IRS sources.</h1>
        <p className="mt-3 rounded-md border-l-4 border-accent bg-accent-soft px-4 py-3 text-sm text-foreground">
          Educational tool only — not tax filing or professional advice. Never enter your SSN or other sensitive personal information.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <label htmlFor="q" className="text-sm font-medium text-foreground">Your tax question</label>
          <textarea id="q" value={q} onChange={(e) => setQ(e.target.value)} rows={3} maxLength={1000}
            placeholder="e.g. How are short-term capital gains taxed?"
            className="w-full rounded-md border border-input bg-background p-3 text-foreground outline-none focus:ring-2 focus:ring-ring" />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={loading}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
              {loading ? "Researching…" : "Submit"}
            </button>
            <button type="button" onClick={() => setQ(SAMPLE)} className="text-sm text-accent underline-offset-4 hover:underline">
              Try sample: “{SAMPLE}”
            </button>
          </div>
        </form>

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Searching IRS.gov and drafting an answer (max {MAX_ITERATIONS} iterations)…
          </div>
        )}

        {err && <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{err}</div>}

        {res && !res.error && (
          <section className="mt-10 space-y-6">
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-xl font-bold text-primary">Answer</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${res.verified ? "bg-accent-soft text-accent" : "bg-muted text-muted-foreground"}`}>
                  {res.verified ? "Grounded in IRS sources" : "Not verified"}
                </span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-card-foreground">{res.answer}</p>
            </div>

            {res.sources.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">IRS sources</h3>
                <ul className="space-y-2">
                  {res.sources.map((s) => (
                    <li key={s.url} className="rounded-md border border-border p-3">
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:text-accent">{s.title}</a>
                      <div className="text-xs text-muted-foreground">{s.url}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">
                Execution trace — {res.iterations} / {MAX_ITERATIONS} iterations{res.stoppedByGuard ? " (stopped by guard)" : ""}
              </summary>
              <ol className="space-y-2 border-t border-border p-4 text-xs">
                {res.trace.map((t, i) => (
                  <li key={i} className="rounded bg-muted p-2">
                    <span className="font-semibold uppercase text-accent">{t.type.replace("_", " ")}</span>
                    {"iteration" in t && <span className="ml-2 text-muted-foreground">iter {t.iteration}</span>}
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-foreground">
                      {t.type === "input" ? t.question : "text" in t ? t.text : JSON.stringify("args" in t ? t.args : t.result, null, 2)}
                    </pre>
                  </li>
                ))}
              </ol>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
