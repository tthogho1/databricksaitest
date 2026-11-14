import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Allow up to 60s for the LLM summarization (Vercel serverless function timeout).
export const maxDuration = 60;

// Environment variables are loaded automatically by Next.js:
//   • Local dev → nextjs/.env.local
//   • Vercel    → Project Settings → Environment Variables
const DATABRICKS_HOST = (() => {
  const host = (process.env.DATABRICKS_HOST ?? "").trim().replace(/\/$/, "");
  if (!host) return "";
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
})();
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN ?? "";

// ── Config (overridable via environment variables) ──────────────────────────
const VS_INDEX =
  process.env.DATABRICKS_VS_INDEX ??
  "workspace.default.wikivoyage_page_index_ai_search";
const EMBEDDING_ENDPOINT =
  process.env.DATABRICKS_EMBEDDING_ENDPOINT ?? "databricks-qwen3-embedding-0-6b";
const LLM_MODEL =
  process.env.LLM_MODEL ?? "databricks-meta-llama-3-3-70b-instruct";

// Qwen3-Embedding: queries get this instruction; the chunks were embedded without one.
const QUERY_PREFIX =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:";

const PAGE_TYPES = ["city", "region", "country"];

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResponse {
  result?: { data_array?: (string | number | null)[][] };
  manifest?: { columns?: { name: string }[] };
}

export interface ResultItem {
  title: string;
  section: string;
  url: string;
  content: string;
  score: number;
}

// 日本語（ひらがな・カタカナ・漢字）が含まれるか判定
const JP_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const isJapanese = (text: string): boolean => JP_REGEX.test(text);

// ── LLM で翻訳（余計な説明を付けず訳文のみ返す） ──────────────────────────────
async function translate(
  client: OpenAI,
  text: string,
  target: "English" | "Japanese"
): Promise<string> {
  if (!text.trim()) return text;
  const res = await client.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content:
          `You are a professional translator. Translate the user's text into natural ${target}. ` +
          `Output only the translation itself, with no quotes, notes, or explanations.`,
      },
      { role: "user", content: text },
    ],
    max_tokens: 1000,
    temperature: 0.2,
  });
  return res.choices[0].message.content?.trim() ?? text;
}

// ── Embed the query with the Qwen3 serving endpoint (L2-normalized) ──────────
async function embedQuery(question: string): Promise<number[]> {
  const url = `${DATABRICKS_HOST}/serving-endpoints/${EMBEDDING_ENDPOINT}/invocations`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DATABRICKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [QUERY_PREFIX + question] }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding failed [${response.status}]: ${error}`);
  }

  const json = await response.json();
  const vec: number[] = json?.data?.[0]?.embedding ?? [];
  const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? vec.map((x) => x / norm) : vec;
}

// ── Vector Search via REST API (precomputed-vector index) ────────────────────
async function similaritySearch(
  queryVector: number[],
  numResults: number,
  pageType?: string
): Promise<SearchResponse> {
  const url = `${DATABRICKS_HOST}/api/2.0/vector-search/indexes/${VS_INDEX}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DATABRICKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_vector: queryVector,
      columns: ["title", "section", "url", "chunk_text"],
      num_results: numResults,
      ...(pageType ? { filters_json: JSON.stringify({ page_type: pageType }) } : {}),
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
    if (!DATABRICKS_HOST || !DATABRICKS_TOKEN) {
      return NextResponse.json(
        { error: "Missing DATABRICKS_HOST or DATABRICKS_TOKEN. Check nextjs/.env.local." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const query: string = (body?.query ?? "").trim();
    const numResults: number = Math.min(Math.max(Number(body?.numResults) || 5, 1), 20);
    const pageType: string | undefined = PAGE_TYPES.includes(body?.pageType)
      ? body.pageType
      : undefined;

    if (!query) {
      return NextResponse.json({ error: "Query must not be empty." }, { status: 400 });
    }

    const llmClient = new OpenAI({
      apiKey: DATABRICKS_TOKEN,
      baseURL: `${DATABRICKS_HOST}/serving-endpoints`,
    });

    // 0) 日本語クエリなら英語に翻訳してから検索（インデックスは英語データ）
    const queryIsJapanese = isJapanese(query);
    const searchQuery = queryIsJapanese
      ? await translate(llmClient, query, "English")
      : query;

    // 1) Embed the query, then similarity search
    const search = await similaritySearch(await embedQuery(searchQuery), numResults, pageType);
    const hits = search?.result?.data_array ?? [];
    const colNames = (search?.manifest?.columns ?? []).map((c) => c.name);

    const results: ResultItem[] = hits.map((hit) => {
      const row: Record<string, string | number | null> = {};
      colNames.forEach((name, idx) => {
        row[name] = hit[idx];
      });
      // chunk_text starts with a "Title (type, region) — Section" header line; drop it
      const text = String(row["chunk_text"] ?? "");
      const content = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : text;
      return {
        title: String(row["title"] ?? "N/A"),
        section: String(row["section"] ?? ""),
        url: String(row["url"] ?? ""),
        content,
        score: Number(row["score"] ?? 0),
      };
    });

    if (results.length === 0) {
      return NextResponse.json({ results: [], summary: "No results found.", searchQuery });
    }

    // 2) Summarize with Databricks LLM
    const contextText = results
      .map((r) => `Title: ${r.title}${r.section ? ` — ${r.section}` : ""}\n${r.content}`)
      .join("\n\n---\n\n");

    // 日本語クエリの場合は日本語で、英語クエリの場合は英語で要約を生成
    const summaryLangInstruction = queryIsJapanese
      ? "Write the summary in natural Japanese (日本語)."
      : "Write the summary in English.";

    const prompt =
      `Based on the following travel information retrieved for the query "${query}",\n` +
      `write a concise and engaging summary (3-5 sentences) highlighting the key points.\n` +
      `${summaryLangInstruction}\n\n` +
      `Retrieved information:\n${contextText}\n\nSummary:`;

    const chatResponse = await llmClient.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are a helpful travel assistant." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.7,
    });

    const summary = chatResponse.choices[0].message.content?.trim() ?? "";

    // 日本語クエリの場合は各結果の content も日本語に翻訳（表示分のみ・並列実行）
    const displayResults: ResultItem[] = queryIsJapanese
      ? await Promise.all(
          results.map(async (r) => ({
            ...r,
            content: await translate(llmClient, r.content.slice(0, 600), "Japanese"),
          }))
        )
      : results;

    return NextResponse.json({ results: displayResults, summary, searchQuery });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
