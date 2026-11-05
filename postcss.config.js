import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import redTheme from "./client/src/theme/red-theme-postcss.js";

export default {
  // redTheme runs last (OnceExit): it derives the red-light twin of every coloured rule, Tailwind's included.
  plugins: [tailwindcss(), autoprefixer(), redTheme()],
};
