import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import toml from "toml";
import prettier from "prettier";

// This recreates __dirname, which doesn't exist by default in this kind of file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the real language file so EJS templates render actual text,
// not the [bracket.placeholder] fallback.
const langPath = path.join(__dirname, "src", "assets", "lang", "en_US.toml");
const langData = toml.parse(fs.readFileSync(langPath, "utf-8"));

const lang = (key) => {
  const parts = key.split(".");
  let res = langData.ejs;

  for (const p of parts) {
    res = res?.[p];
  }

  return res ?? `[${key}]`;
};

const data = {
  bkid: 1,
  lang,
};

const templatePath = path.join(__dirname, "src", "app.ejs");
const outputPath = path.join(__dirname, "index.html");

ejs.renderFile(templatePath, data, async (err, html) => {
  if (err) {
    console.error("Render failed:");
    console.error(err);
    return;
  }

  try {
    const formattedHtml = await prettier.format(html, {
      parser: "html",
    });

    fs.writeFileSync(outputPath, formattedHtml);
    console.log("index.html written and formatted successfully.");
  } catch (err) {
    console.error("Prettier failed:");
    console.error(err);
  }
});
