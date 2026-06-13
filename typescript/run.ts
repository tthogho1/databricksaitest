import * as dotenv from "dotenv";
import * as path from "path";
import OpenAI from "openai";

// ── Load environment variables from root .env ─────────────────────────────────
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const WORKSPACE_URL    = (process.env.WORKSPACE_URL ?? "").replace(/\/$/, "");
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN ?? "";

const missing = [
  !WORKSPACE_URL    && "WORKSPACE_URL",
  !DATABRICKS_TOKEN && "DATABRICKS_TOKEN",
].filter(Boolean);

if (missing.length > 0) {
  throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
}

console.log(`WORKSPACE_URL    : ${WORKSPACE_URL}`);
console.log(`DATABRICKS_TOKEN : ${"*".repeat(DATABRICKS_TOKEN.length)}`);

// ── Config ────────────────────────────────────────────────────────────────────
const INDEX_NAME  = "workspace.default.wikivoyage_index";
const QUERY_TEXT  = "best places to visit in Japan";  // ← change me
const NUM_RESULTS = 3;
const LLM_MODEL   = "databricks-meta-llama-3-3-70b-instruct";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResponse {
  result: {
    data_array: (string | number | null)[][];
  };
  manifest: {
    columns: { name: string }[];
  };
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
      columns:     ["content", "title"],
      query_text:  queryText,
      query_type:  "HYBRID",
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
  const results  = await similaritySearch(QUERY_TEXT, NUM_RESULTS);
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
    const content = row["content"] ?? "";

    console.log(`\n── Result ${i + 1} ${"─".repeat(45)}`);
    console.log(`  Title   : ${title}`);
    console.log(`  Content : ${content.substring(0, 300)}${content.length > 300 ? "..." : ""}`);
    contextParts.push(`Title: ${title}\n${content}`);
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

  const llmClient = new OpenAI({
    apiKey:  DATABRICKS_TOKEN,
    baseURL: `${WORKSPACE_URL}/serving-endpoints`,
  });

  const chatResponse = await llmClient.chat.completions.create({
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
