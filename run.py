import math
import os
from dotenv import load_dotenv
from databricks.ai_search.client import VectorSearchClient
from openai import OpenAI

# ── Load environment variables from .env ──────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)

host         = (os.environ.get("DATABRICKS_HOST") or "").strip().rstrip("/")
access_token = os.environ.get("DATABRICKS_TOKEN")

# Validate required variables
missing = [k for k, v in {
    "DATABRICKS_HOST":  host,
    "DATABRICKS_TOKEN": access_token,
}.items() if not v]

if missing:
    raise EnvironmentError(
        f"Missing required environment variable(s): {', '.join(missing)}\n"
        "Edit the .env file in the project root and set the values there."
    )

workspace_url = host if host.startswith(("https://", "http://")) else "https://" + host

print(f"DATABRICKS_HOST  : {workspace_url}")
print(f"DATABRICKS_TOKEN : {'*' * len(access_token)}")

# ── Config ───────────────────────────────────────────────────────────────────
ENDPOINT_NAME      = os.environ.get("DATABRICKS_VS_ENDPOINT", "wikivoyage-ai-search-endpoint")
INDEX_NAME         = os.environ.get("DATABRICKS_VS_INDEX", "workspace.default.wikivoyage_page_index_ai_search")
EMBEDDING_ENDPOINT = os.environ.get("DATABRICKS_EMBEDDING_ENDPOINT", "databricks-qwen3-embedding-0-6b")
LLM_MODEL          = os.environ.get("LLM_MODEL", "databricks-meta-llama-3-3-70b-instruct")

# Qwen3-Embedding: queries get this instruction; the chunks were embedded without one.
QUERY_PREFIX = ("Instruct: Given a web search query, retrieve relevant passages "
                "that answer the query\nQuery:")

# ── Initialize clients ────────────────────────────────────────────────────────
vsc = VectorSearchClient(
    workspace_url=workspace_url,
    personal_access_token=access_token,
    disable_notice=True,
)
print("\nVectorSearchClient initialized successfully.")

# Databricks serving endpoints (embedding + LLM) are OpenAI-compatible
llm_client = OpenAI(
    api_key=access_token,
    base_url=f"{workspace_url}/serving-endpoints",
)

# ── Connect to Vector Search Index ────────────────────────────────────────────
index = vsc.get_index(
    endpoint_name=ENDPOINT_NAME,
    index_name=INDEX_NAME,
)
print(f"Connected to index : {INDEX_NAME}")
print(f"Endpoint           : {ENDPOINT_NAME}")

# ── Embed the query (L2-normalized) ───────────────────────────────────────────
QUERY_TEXT  = "best places to visit in Japan"   # ← change me
NUM_RESULTS = 3

embedding = llm_client.embeddings.create(
    model=EMBEDDING_ENDPOINT,
    input=[QUERY_PREFIX + QUERY_TEXT],
    encoding_format="float",  # Databricks returns floats; the SDK default (base64) can garble them
).data[0].embedding
norm = math.sqrt(sum(x * x for x in embedding))
query_vector = [x / norm for x in embedding]

# ── Perform Similarity Search ─────────────────────────────────────────────────
results = index.similarity_search(
    query_vector=query_vector,
    columns=["title", "section", "url", "chunk_text"],
    num_results=NUM_RESULTS,
)

# ── Display results ────────────────────────────────────────────────────────────
print(f"\nQuery : '{QUERY_TEXT}'")
print(f"Top {NUM_RESULTS} results\n" + "=" * 60)

hits = results.get("result", {}).get("data_array", [])
columns_returned = results.get("manifest", {}).get("columns", [])
col_names = [c.get("name") for c in columns_returned]

if not hits:
    print("No results found.")
    exit(0)

context_parts = []
for rank, hit in enumerate(hits, start=1):
    row = dict(zip(col_names, hit))
    title   = row.get("title", "N/A")
    section = row.get("section", "")
    # chunk_text starts with a "Title (type, region) — Section" header line; drop it
    content = str(row.get("chunk_text", "")).split("\n", 1)[-1]
    print(f"\n── Result {rank} ──────────────────────────────────────")
    print(f"  Title   : {title} — {section}  [{row.get('score', 0):.3f}]")
    print(f"  URL     : {row.get('url', '')}")
    print(f"  Content : {content[:300]}{'...' if len(content) > 300 else ''}")
    context_parts.append(f"Title: {title} — {section}\n{content}")

# ── Summarize with Databricks LLM ─────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"Summarizing with Databricks LLM: '{LLM_MODEL}'")
print("=" * 60)

context_text = "\n\n---\n\n".join(context_parts)
prompt = (
    f'Based on the following travel information retrieved for the query "{QUERY_TEXT}",\n'
    f"write a concise and engaging summary (3-5 sentences) highlighting the key points.\n\n"
    f"Retrieved information:\n{context_text}\n\nSummary:"
)

chat_response = llm_client.chat.completions.create(
    model=LLM_MODEL,
    messages=[
        {"role": "system", "content": "You are a helpful travel assistant."},
        {"role": "user",   "content": prompt},
    ],
    max_tokens=300,
    temperature=0.7,
)

summary = chat_response.choices[0].message.content.strip()
print(f"\n{summary}\n")
