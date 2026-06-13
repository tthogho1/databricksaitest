import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Allow up to 60s for the LLM summarization (Vercel serverless function timeout).
export const maxDuration = 60;

// Environment variables are loaded automatically by Next.js:
//   • Local dev → nextjs/.env.local
//   • Vercel    → Project Settings → Environment Variables
const WORKSPACE_URL = (process.env.WORKSPACE_URL ?? "").replace(/\/$/, "");
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN ?? "";

// ── Config (overridable via environment variables) ──────────────────────────
const INDEX_NAME =
  process.env.INDEX_NAME ?? "workspace.default.wikivoyage_index";
const LLM_MODEL =
  process.env.LLM_MODEL ?? "databricks-meta-llama-3-3-70b-instruct";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResponse {
  result: { data_array: (string | number | null)[][] };
  manifest: { columns: { name: string }[] };
}

export interface ResultItem {
  title: string;
  content: string;
}

// ── Vector Search via REST API ────────────────────────────────────────────────
async function similaritySearch(
  queryText: string,
  numResults: number
): Promise<SearchResponse> {
  const url = `${WORKSPACE_URL}/api/2.0/vector-search/indexes/${INDEX_NAME}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DATABRICKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      num_results: numResults,
      columns: ["content", "title"],
      query_text: queryText,
      query_type: "HYBRID",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vector Search failed [${response.status}]: ${error}`);
  }

  return response.json() as Promise<SearchResponse>;
}

// ── POST /api/search ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    if (!WORKSPACE_URL || !DATABRICKS_TOKEN) {
      return NextResponse.json(
        { error: "Missing WORKSPACE_URL or DATABRICKS_TOKEN. Check the root .env file." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const query: string = (body?.query ?? "").trim();
    const numResults: number = body?.numResults ?? 3;

    if (!query) {
      return NextResponse.json({ error: "Query must not be empty." }, { status: 400 });
    }

    // 1) Similarity search
    const search = await similaritySearch(query, numResults);
    const hits = search?.result?.data_array ?? [];
    const colNames = (search?.manifest?.columns ?? []).map((c) => c.name);

    const results: ResultItem[] = hits.map((hit) => {
      const row: Record<string, string> = {};
      colNames.forEach((name, idx) => {
        row[name] = String(hit[idx] ?? "");
      });
      return {
        title: row["title"] ?? "N/A",
        content: row["content"] ?? "",
      };
    });

    if (results.length === 0) {
      return NextResponse.json({ results: [], summary: "No results found." });
    }

    // 2) Summarize with Databricks LLM
    const contextText = results
      .map((r) => `Title: ${r.title}\n${r.content}`)
      .join("\n\n---\n\n");

    const prompt =
      `Based on the following travel information retrieved for the query "${query}",\n` +
      `write a concise and engaging summary (3-5 sentences) highlighting the key points.\n\n` +
      `Retrieved information:\n${contextText}\n\nSummary:`;

    const llmClient = new OpenAI({
      apiKey: DATABRICKS_TOKEN,
      baseURL: `${WORKSPACE_URL}/serving-endpoints`,
    });

    const chatResponse = await llmClient.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are a helpful travel assistant." },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const summary = chatResponse.choices[0].message.content?.trim() ?? "";

    return NextResponse.json({ results, summary });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
