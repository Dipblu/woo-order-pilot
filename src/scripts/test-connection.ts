import "dotenv/config";
import { pool } from "../lib/db.js";

async function main() {
  const client = await pool.connect();
  try {
    const { rows: versionRows } = await client.query("select version()");
    console.log("Connected:", versionRows[0].version);

    const { rows: extRows } = await client.query(
      "select extname from pg_extension where extname = 'vector'"
    );
    console.log(
      extRows.length > 0
        ? "pgvector extension: enabled"
        : "pgvector extension: NOT FOUND"
    );

    const { rows: countRows } = await client.query(
      "select count(*)::int as count from documents"
    );
    console.log(`documents table: ${countRows[0].count} row(s)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Connection test failed:", err.message);
  process.exit(1);
});
