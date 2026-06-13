import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0f172a",
        panel: "#1e293b",
        panel2: "#273449",
        accent: "#38bdf8",
        accent2: "#818cf8",
        muted: "#94a3b8",
      },
      backgroundImage: {
        "accent-gradient": "linear-gradient(90deg, #38bdf8, #818cf8)",
      },
    },
  },
  plugins: [],
};

export default config;
