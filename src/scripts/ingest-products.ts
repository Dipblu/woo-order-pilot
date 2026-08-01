import "dotenv/config";
import { pool } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";
import { fetchAllProducts } from "../lib/woocommerce.js";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("Fetching products from WooCommerce...");
  const products = await fetchAllProducts();
  console.log(`Fetched ${products.length} published product(s).`);

  if (products.length === 0) {
    console.log("No products found, nothing to ingest.");
    return;
  }

  const contents = products.map((p) => {
    const categories =
      p.categories?.map((c) => c.name).join(", ") || "Uncategorized";
    const description = stripHtml(p.short_description || p.description || "");
    return [
      `Product: ${p.name}`,
      `SKU: ${p.sku || "N/A"}`,
      `Price: ${p.price}`,
      `Stock: ${p.stock_status}`,
      `Categories: ${categories}`,
      `Description: ${description}`,
    ].join("\n");
  });

  console.log("Requesting embeddings...");
  const embeddings = await embed(contents);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Full resync of product-sourced rows only; FAQ rows (source = 'faq') are untouched.
    await client.query("DELETE FROM documents WHERE metadata->>'source' = 'product'");

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const metadata = {
        source: "product",
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        permalink: p.permalink,
      };

      await client.query(
        `insert into documents (content, metadata, embedding)
         values ($1, $2, $3::vector)`,
        [contents[i], metadata, JSON.stringify(embeddings[i])]
      );
    }

    await client.query("COMMIT");
    console.log(`Ingested ${products.length} product(s) into documents.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Product ingestion failed:", err.message);
  process.exit(1);
});
