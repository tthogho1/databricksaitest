import os
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
from sentence_transformers import SentenceTransformer

# ── Load environment variables from the project-root .env ─────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)

workspace_url = os.environ.get("WORKSPACE_URL")
access_token  = os.environ.get("DATABRICKS_TOKEN")

missing = [k for k, v in {
    "WORKSPACE_URL":    workspace_url,
    "DATABRICKS_TOKEN": access_token,
}.items() if not v]

if missing:
    raise EnvironmentError(
        f"Missing required environment variable(s): {', '.join(missing)}\n"
        "Edit the .env file in the project root and set the values there."
    )

# ── Config ───────────────────────────────────────────────────────────────────
REMOTE_MODEL = "databricks-qwen3-embedding-0-6b"
LOCAL_MODEL  = "Qwen/Qwen3-Embedding-0.6B"

TEXTS = [
    "best places to visit in Japan",
    "Tokyo is the capital of Japan and its largest city.",
]

# ── Embed with the Databricks serving endpoint ───────────────────────────────
client = OpenAI(
    api_key=access_token,
    base_url=f"{workspace_url}/serving-endpoints",
)
remote = np.array([d.embedding for d in client.embeddings.create(
    model=REMOTE_MODEL, input=TEXTS).data])

# ── Embed locally (with and without the query instruction prompt) ─────────────
local = SentenceTransformer(LOCAL_MODEL)
plain = local.encode(TEXTS, normalize_embeddings=True)
query = local.encode(TEXTS, prompt_name="query", normalize_embeddings=True)

# ── Compare ──────────────────────────────────────────────────────────────────
def cos(a, b):
    return float(a @ b / np.linalg.norm(a) / np.linalg.norm(b))

print(f"dims: remote={remote.shape[1]} local={plain.shape[1]}")
if remote.shape[1] != plain.shape[1]:
    raise SystemExit("Dimensions differ; the vectors are not comparable.")

for i, t in enumerate(TEXTS):
    print(f"{t[:40]!r:44} no-prompt={cos(remote[i], plain[i]):.4f}  "
          f"query-prompt={cos(remote[i], query[i]):.4f}")
