/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Paleta AccesoPro — tomada del panel ops de referencia */
        ink: "#0B1A28",
        panel: "#152433",
        panel2: "#1A2C3D",
        line: "#2A4054",
        accent: "#1A9FBF",
        ok: "#3DCF7A",
        warn: "#E8B84A",
        danger: "#D94A4A",
        muted: "#7A93A8",
      },
      boxShadow: {
        card: "0 0 0 1px rgba(26,159,191,.08), 0 8px 24px rgba(0,12,24,.5)",
      },
      fontFamily: {
        sans: ["var(--font-ap-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-ap-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
