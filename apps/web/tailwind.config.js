/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1420",
        panel: "#162539",
        panel2: "#132236",
        line: "#294362",
        accent: "#2fa4ff",
        ok: "#22c55e",
        warn: "#eab308",
        danger: "#ef4444",
        muted: "#9fb3c9",
      },
      boxShadow: {
        card: "0 8px 26px rgba(0,0,0,.38)",
      },
    },
  },
  plugins: [],
};
