import os
from dotenv import load_dotenv
from databricks.ai_search.client import VectorSearchClient
from openai import OpenAI

# ── Load environment variables from .env ──────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)

workspace_url = os.environ.get("WORKSPACE_URL")
access_token  = os.environ.get("DATABRICKS_TOKEN")

# Validate required variables
missing = [k for k, v in {
    "WORKSPACE_URL":    workspace_url,
    "DATABRICKS_TOKEN": access_token,
}.items() if not v]

if missing:
    raise EnvironmentError(
        f"Missing required environment variable(s): {', '.join(missing)}\n"
        "Edit the .env file in the project root and set the values there."
    )

print(f"WORKSPACE_URL    : {workspace_url}")
print(f"DATABRICKS_TOKEN : {'*' * len(access_token)}")

# ── Config ───────────────────────────────────────────────────────────────────
LLM_MODEL = "databricks-meta-llama-3-3-70b-instruct"  # ← change to any available serving endpoint

# ── Initialize Vector Search Client ───────────────────────────────────────────
vsc = VectorSearchClient(
    workspace_url=workspace_url,
    personal_access_token=access_token,
    disable_notice=True,
)
print("\nVectorSearchClient initialized successfully.")

# ── Connect to Vector Search Index ────────────────────────────────────────────
ENDPOINT_NAME = "wikivoyage_seach_endpoint"
INDEX_NAME    = "workspace.default.wikivoyage_index"

index = vsc.get_index(
    endpoint_name=ENDPOINT_NAME,
    index_name=INDEX_NAME,
)
print(f"Connected to index : {INDEX_NAME}")
print(f"Endpoint           : {ENDPOINT_NAME}")

# ── Perform Hybrid Similarity Search with Reranking ───────────────────────────
QUERY_TEXT  = "best places to visit in Japan"   # ← change me
NUM_RESULTS = 3
COLUMNS     = ["content", "title"]

results = index.similarity_search(
    num_results=NUM_RESULTS,
    columns=COLUMNS,
    query_text=QUERY_TEXT,
    query_type="HYBRID",
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
    content = str(row.get("content", ""))
    print(f"\n── Result {rank} ──────────────────────────────────────")
    print(f"  Title   : {title}")
    print(f"  Content : {content[:300]}{'...' if len(content) > 300 else ''}")
    context_parts.append(f"Title: {title}\n{content}")

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

llm_client = OpenAI(
    api_key=access_token,
    base_url=f"{workspace_url}/serving-endpoints",
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
