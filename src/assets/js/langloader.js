import toml from "toml";
import merge from "lodash.merge";

let lang;

async function loadLanguage(id) {
  const res = await fetch(`./src/assets/lang/${id}.toml`);
  const text = await res.text();
  lang = merge(lang || {}, toml.parse(text) || {});
}

function query(id, placeHolders) {
  const parts = id.split(".");
  let res = lang;
  for (const p of parts) {
    res = res[p];
  }
  let text = res === lang ? "" : res;
  if (placeHolders) {
    Object.entries(placeHolders).forEach(([key, value]) => {
      text = text.replace(`{${key}}`, value);
    });
  }
  return text;
}

function queryJS(id, placeHolders) {
  return query(`js.${id}`, placeHolders);
}

function queryEJS(id, placeHolders) {
  return query(`ejs.${id}`, placeHolders);
}

async function setupLanguage() {
  await loadLanguage("en_US");
  try {
    await loadLanguage("_custom");
  } catch {
    // Optional custom overrides file — fine if it doesn't exist.
  }
}

export default { loadLanguage, query, queryJS, queryEJS, setupLanguage };
