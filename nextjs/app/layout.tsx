import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wikivoyage AI Search",
  description: "Databricks Vector Search + LLM summarization",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
