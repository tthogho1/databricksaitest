import * as dotenv from "dotenv";
import * as path from "path";
import OpenAI from "openai";

// ── Load environment variables from root .env ─────────────────────────────────
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const HOST             = (process.env.DATABRICKS_HOST ?? "").trim().replace(/\/$/, "");
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN ?? "";

const missing = [
  !HOST             && "DATABRICKS_HOST",
  !DATABRICKS_TOKEN && "DATABRICKS_TOKEN",
].filter(Boolean);

if (missing.length > 0) {
  throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
}

const WORKSPACE_URL = /^https?:\/\//.test(HOST) ? HOST : `https://${HOST}`;

console.log(`DATABRICKS_HOST  : ${WORKSPACE_URL}`);
console.log(`DATABRICKS_TOKEN : ${"*".repeat(DATABRICKS_TOKEN.length)}`);

// ── Config ────────────────────────────────────────────────────────────────────
const INDEX_NAME =
  process.env.DATABRICKS_VS_INDEX ?? "workspace.default.wikivoyage_page_index_ai_search";
const EMBEDDING_ENDPOINT =
  process.env.DATABRICKS_EMBEDDING_ENDPOINT ?? "databricks-qwen3-embedding-0-6b";
const LLM_MODEL   = process.env.LLM_MODEL ?? "databricks-meta-llama-3-3-70b-instruct";
const QUERY_TEXT  = "best places to visit in Japan";  // ← change me
const NUM_RESULTS = 3;

// Qwen3-Embedding: queries get this instruction; the chunks were embedded without one.
const QUERY_PREFIX =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResponse {
  result: {
    data_array: (string | number | null)[][];
  };
  manifest: {
    columns: { name: string }[];
  };
}

// Databricks serving endpoints (embedding + LLM) are OpenAI-compatible
const client = new OpenAI({
  apiKey:  DATABRICKS_TOKEN,
  baseURL: `${WORKSPACE_URL}/serving-endpoints`,
});

// ── Embed the query (L2-normalized) ───────────────────────────────────────────
async function embedQuery(question: string): Promise<number[]> {
  const res = await client.embeddings.create({
    model: EMBEDDING_ENDPOINT,
    input: [QUERY_PREFIX + question],
    encoding_format: "float",  // Databricks returns floats; the SDK default (base64) garbles them
  });
  const vec  = res.data[0].embedding;
  const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
  return vec.map((x) => x / norm);
}

// ── Vector Search via REST API ────────────────────────────────────────────────
async function similaritySearch(
  queryVector: number[],
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
      num_results:  numResults,
      columns:      ["title", "section", "url", "chunk_text"],
      query_vector: queryVector,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vector Search failed [${response.status}]: ${error}`);
  }

  return response.json() as Promise<SearchResponse>;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\nConnecting to index : ${INDEX_NAME}`);

  // ── Similarity search ───────────────────────────────────────────────────────
  const results  = await similaritySearch(await embedQuery(QUERY_TEXT), NUM_RESULTS);
  const hits     = results?.result?.data_array ?? [];
  const colNames = (results?.manifest?.columns ?? []).map((c) => c.name);

  console.log(`\nQuery : '${QUERY_TEXT}'`);
  console.log(`Top ${NUM_RESULTS} results\n` + "=".repeat(60));

  if (hits.length === 0) {
    console.log("No results found.");
    return;
  }

  const contextParts: string[] = [];

  hits.forEach((hit, i) => {
    const row: Record<string, string> = {};
    colNames.forEach((name, idx) => {
      row[name] = String(hit[idx] ?? "");
    });

    const title   = row["title"]   ?? "N/A";
    const section = row["section"] ?? "";
    // chunk_text starts with a "Title (type, region) — Section" header line; drop it
    const text    = row["chunk_text"] ?? "";
    const content = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : text;

    console.log(`\n── Result ${i + 1} ${"─".repeat(45)}`);
    console.log(`  Title   : ${title} — ${section}  [${Number(row["score"]).toFixed(3)}]`);
    console.log(`  URL     : ${row["url"] ?? ""}`);
    console.log(`  Content : ${content.substring(0, 300)}${content.length > 300 ? "..." : ""}`);
    contextParts.push(`Title: ${title} — ${section}\n${content}`);
  });

  // ── Summarize with Databricks LLM ──────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`Summarizing with Databricks LLM: '${LLM_MODEL}'`);
  console.log("=".repeat(60));

  const contextText = contextParts.join("\n\n---\n\n");
  const prompt =
    `Based on the following travel information retrieved for the query "${QUERY_TEXT}",\n` +
    `write a concise and engaging summary (3-5 sentences) highlighting the key points.\n\n` +
    `Retrieved information:\n${contextText}\n\nSummary:`;

  const chatResponse = await client.chat.completions.create({
    model:       LLM_MODEL,
    messages: [
      { role: "system", content: "You are a helpful travel assistant." },
      { role: "user",   content: prompt },
    ],
    max_tokens:  300,
    temperature: 0.7,
  });

  const summary = chatResponse.choices[0].message.content?.trim() ?? "";
  console.log(`\n${summary}\n`);
}

main().catch((err) => {
  console.error("Error:", (err as Error).message);
  process.exit(1);
});
