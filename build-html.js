import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import toml from "toml";

// This recreates __dirname, which doesn't exist by default in this kind of file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the real language file so EJS templates render actual text,
// not the [bracket.placeholder] fallback.
const langPath = path.join(__dirname, "src", "assets", "lang", "en_US.toml");
const langData = toml.parse(fs.readFileSync(langPath, "utf-8"));

const lang = (key) => {
  const parts = key.split(".");
  let res = langData.ejs; // EJS-side keys live under the [ejs.*] sections
  for (const p of parts) {
    res = res?.[p];
  }
  return res ?? `[${key}]`;
};

const data = {
  bkid: 1, // placeholder background image id
  lang: lang,
};

const templatePath = path.join(__dirname, "src", "app.ejs");

ejs.renderFile(templatePath, data, (err, html) => {
  if (err) {
    console.error("Render failed:");
    console.error(err);
    return;
  }

  const outputPath = path.join(__dirname, "index.html");
  fs.writeFileSync(outputPath, html);
  console.log("index.html written successfully.");
});
