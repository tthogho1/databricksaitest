import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 許可するオリジン。
//   • 本番   → 環境変数 ALLOWED_ORIGIN に許可したいオリジンを設定（例: https://example.com）
//   • 未設定 → "*"（全オリジン許可）
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400", // Preflight 結果を 24h キャッシュ
};

// "*" 以外（特定オリジン指定）の場合は Cookie 等の資格情報を許可
if (ALLOWED_ORIGIN !== "*") {
  CORS_HEADERS["Access-Control-Allow-Credentials"] = "true";
}

export function middleware(request: NextRequest) {
  // ── Preflight (OPTIONS) リクエストへの応答 ──────────────────────────────
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── 通常リクエスト: レスポンスに CORS ヘッダーを付与 ────────────────────
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

// API Routes にのみ適用
export const config = {
  matcher: "/api/:path*",
};
