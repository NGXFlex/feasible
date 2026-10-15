// Writes src/palettes.css from src/palettes.js. Run: npm run palettes
import { writeFileSync } from "node:fs";
import { paletteCss } from "../src/palettes.js";

writeFileSync(new URL("../src/palettes.css", import.meta.url), paletteCss());
console.log("wrote src/palettes.css");
