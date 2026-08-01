import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Faq = { id: string; question: string; answer: string };

async function main() {
  const faqsPath = path.join(__dirname, "../data/faqs.json");
  const faqs: Faq[] = JSON.parse(await readFile(faqsPath, "utf-8"));
  console.log(`Loaded ${faqs.length} FAQ entries from ${faqsPath}`);

  const contents = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`);

  console.log("Requesting embeddings...");
  const embeddings = await embed(contents);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Full resync of FAQ-sourced rows only; product rows (source = 'product') are untouched.
    await client.query("DELETE FROM documents WHERE metadata->>'source' = 'faq'");

    for (let i = 0; i < faqs.length; i++) {
      const faq = faqs[i];
      const metadata = { source: "faq", faq_id: faq.id, question: faq.question };

      await client.query(
        `insert into documents (content, metadata, embedding)
         values ($1, $2, $3::vector)`,
        [contents[i], metadata, JSON.stringify(embeddings[i])]
      );
    }

    await client.query("COMMIT");
    console.log(`Ingested ${faqs.length} FAQ entries into documents.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FAQ ingestion failed:", err.message);
  process.exit(1);
});
