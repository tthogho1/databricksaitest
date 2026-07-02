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
  url: string;
}

// 日本語（ひらがな・カタカナ・漢字）が含まれるか判定
const JP_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
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
      columns: ["content", "title", "url"],
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

    const llmClient = new OpenAI({
      apiKey: DATABRICKS_TOKEN,
      baseURL: `${WORKSPACE_URL}/serving-endpoints`,
    });

    // 0) 日本語クエリなら英語に翻訳してから検索（インデックスは英語データ）
    const queryIsJapanese = isJapanese(query);
    const searchQuery = queryIsJapanese
      ? await translate(llmClient, query, "English")
      : query;

    // 1) Similarity search
    const search = await similaritySearch(searchQuery, numResults);
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
        url: row["url"] ?? "",
      };
    });

    if (results.length === 0) {
      return NextResponse.json({ results: [], summary: "No results found." });
    }

    // 2) Summarize with Databricks LLM
    const contextText = results
      .map((r) => `Title: ${r.title}\n${r.content}`)
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
            content: await translate(
              llmClient,
              r.content.slice(0, 600),
              "Japanese"
            ),
          }))
        )
      : results;

    return NextResponse.json({ results: displayResults, summary });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
