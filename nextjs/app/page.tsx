"use client";

import { useState } from "react";

interface ResultItem {
  title: string;
  section: string;
  url: string;
  content: string;
  score: number;
}

interface ApiResponse {
  results: ResultItem[];
  summary: string;
  searchQuery?: string;
  error?: string;
}

const PAGE_TYPES = [
  { value: "", label: "All types" },
  { value: "city", label: "City" },
  { value: "region", label: "Region" },
  { value: "country", label: "Country" },
];

const NUM_RESULTS = [3, 5, 10];

export default function Home() {
  const [query, setQuery] = useState("best places to visit in Japan");
  const [pageType, setPageType] = useState("");
  const [numResults, setNumResults] = useState(5);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setData(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, numResults, pageType }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <header className="mb-8 text-center sm:mb-10">
        <h1 className="text-gradient text-3xl font-bold sm:text-4xl">
          🧭 Wikivoyage AI Search
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          Vector search over Wikivoyage chunks on Databricks, summarized by an LLM.
        </p>
      </header>

      <form
        onSubmit={handleSearch}
        className="mb-6 flex flex-col gap-3 sm:flex-row"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything, e.g. best places to visit in Japan"
          disabled={loading}
          className="flex-1 rounded-xl border border-slate-700 bg-panel px-4 py-3 text-base text-slate-200 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-accent-gradient px-6 py-3 text-base font-semibold text-bg transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <select
          value={pageType}
          onChange={(e) => setPageType(e.target.value)}
          disabled={loading}
          aria-label="Page type"
          className="rounded-lg border border-slate-700 bg-panel px-3 py-2 text-slate-200 outline-none focus:border-accent disabled:opacity-60"
        >
          {PAGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={numResults}
          onChange={(e) => setNumResults(Number(e.target.value))}
          disabled={loading}
          aria-label="Number of results"
          className="rounded-lg border border-slate-700 bg-panel px-3 py-2 text-slate-200 outline-none focus:border-accent disabled:opacity-60"
        >
          {NUM_RESULTS.map((n) => (
            <option key={n} value={n}>
              {n} results
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-muted">Querying Databricks…</div>
      )}

      {data && (
        <section>
          {data.summary && (
            <div className="mb-8 rounded-2xl border border-slate-700 bg-gradient-to-br from-accent/10 to-accent2/10 p-5 sm:p-6">
              <h2 className="mb-3 text-base font-semibold text-accent sm:text-lg">
                ✨ AI Summary
              </h2>
              <p className="text-base leading-relaxed sm:text-lg">
                {data.summary}
              </p>
            </div>
          )}

          <h2 className="mb-4 text-base font-medium text-muted sm:text-lg">
            Top Results
            {data.searchQuery && data.searchQuery !== query.trim() && (
              <span className="ml-2 text-sm">(searched as “{data.searchQuery}”)</span>
            )}
          </h2>
          <div className="flex flex-col gap-4">
            {data.results.map((r, i) => (
              <article
                key={i}
                className="rounded-2xl border border-slate-700 bg-panel p-5 transition hover:-translate-y-0.5 hover:border-accent"
              >
                <h3 className="mb-2.5 flex items-center gap-2.5 text-lg font-semibold">
                  <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-bg">
                    {i + 1}
                  </span>
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline-offset-2 transition hover:underline"
                    >
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                  <span className="ml-auto text-xs font-normal text-muted">
                    {r.score.toFixed(3)}
                  </span>
                </h3>
                {r.section && (
                  <p className="mb-2 text-sm text-accent2">{r.section}</p>
                )}
                <p className="whitespace-pre-wrap text-muted">
                  {r.content.length > 400
                    ? r.content.substring(0, 400) + "…"
                    : r.content}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
