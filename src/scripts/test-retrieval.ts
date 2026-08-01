import "dotenv/config";
import { pool } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";

const DEFAULT_QUESTION = "How long will my delivery take?";
const TOP_K = 5;

async function main() {
  const question = process.argv.slice(2).join(" ") || DEFAULT_QUESTION;
  console.log(`Question: ${question}\n`);

  const [queryEmbedding] = await embed([question]);

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `select
         content,
         metadata,
         1 - (embedding <=> $1::vector) as similarity
       from documents
       order by embedding <=> $1::vector
       limit $2`,
      [JSON.stringify(queryEmbedding), TOP_K]
    );

    rows.forEach((row, i) => {
      const source = row.metadata?.source ?? "unknown";
      console.log(
        `#${i + 1} [${source}] similarity=${row.similarity.toFixed(4)}`
      );
      console.log(row.content);
      console.log("---");
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Retrieval test failed:", err.message);
  process.exit(1);
});
