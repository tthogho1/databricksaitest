"use client";

import { useState } from "react";

interface ResultItem {
  title: string;
  content: string;
}

interface ApiResponse {
  results: ResultItem[];
  summary: string;
  error?: string;
}

export default function Home() {
  const [query, setQuery] = useState("best places to visit in Japan");
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
        body: JSON.stringify({ query, numResults: 3 }),
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
          Hybrid vector search on Databricks, summarized by an LLM.
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
                  {r.title}
                </h3>
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
