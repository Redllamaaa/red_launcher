import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This recreates __dirname, which doesn't exist by default in this kind of file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Placeholder for the lang() function your templates call.
// Real one comes later — for now it just prints the key so you can see where text goes.
const lang = (key) => `[${key}]`;

const data = {
  bkid: 1, // placeholder background image id
  lang: lang, // the fake lang function above
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
