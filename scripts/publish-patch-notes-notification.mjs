import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const environment = args.has("--staging") ? "staging" : args.has("--production") ? "production" : null;
const version = "0.0.6.0";
const announcementId = `patch-notes:${version}`;

if (environment == null) {
  throw new Error("Pass exactly one of --staging or --production.");
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
}

const markdown = readFileSync(resolve(root, `docs/patch-notes/${version}.md`), "utf8");
const title = `PokeRogue Redux v${version}`;
const body = `Open the full v${version} patch notes.`;
const payload = JSON.stringify({
  announcementId,
  markdown,
  actionLabel: "Join PokeRogue Redux Discord",
  actionUrl: "https://discord.gg/q8d2jq5dE",
});
const quote = value => `'${value.replaceAll("'", "''")}'`;
const match = `username = '*' AND kind = 'patch-notes' AND json_extract(payload, '$.announcementId') = ${quote(announcementId)}`;

const writeSql =
  environment === "staging"
    ? `UPDATE notifications
         SET title = ${quote(title)}, body = ${quote(body)}, payload = ${quote(payload)}
       WHERE id = 4 AND username = '*' AND kind = 'patch-notes';`
    : `INSERT INTO notifications (username, kind, title, body, payload, created_at)
       SELECT '*', 'patch-notes', ${quote(title)}, ${quote(body)}, ${quote(payload)}, ${Date.now()}
       WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE ${match});`;
const verifySql = `SELECT id, username, kind, title, json_extract(payload, '$.announcementId') AS announcement_id,
                          length(json_extract(payload, '$.markdown')) AS markdown_length, created_at
                     FROM notifications
                    WHERE ${match}
                    ORDER BY id DESC;`;

const databaseId =
  environment === "staging" ? "7dc09f64-6810-4756-8c0f-e44f7d382eed" : "b2fae947-6971-45e7-b287-d42648fd0a30";
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: `${writeSql}\n${verifySql}` }),
  },
);
const result = await response.json();
if (!response.ok || !result.success || !result.result?.every(query => query.success)) {
  throw new Error(`Cloudflare D1 query failed (${response.status}): ${JSON.stringify(result.errors ?? result)}`);
}
console.log(JSON.stringify(result.result, null, 2));
