import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f7f3ea",
        ink: "#2f3325",
        sage: "#c8cf9e",
        coral: "#f26b7a",
        night: "#151713",
        cream: "#f5eddc"
      },
      boxShadow: {
        dock: "0 24px 70px rgba(44, 48, 37, 0.12)"
      }
    }
  },
  plugins: []
} satisfies Config;

