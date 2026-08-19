import "dotenv/config";
import { pool } from "../lib/db.js";
import { embed } from "../lib/embeddings.js";

const TOP_K = 5;
const MATCH_WITHIN = 3; // pass if expected result appears in top 3

type TestCase = {
  question: string;
  expectedSource: "faq" | "product";
  expectedId: string; // faq_id for FAQs, name for products
};

const TEST_CASES: TestCase[] = [
  { question: "What is your refund policy if my order arrives wrong or incomplete?", expectedSource: "faq", expectedId: "faq-001" },
  { question: "How long does delivery take?", expectedSource: "faq", expectedId: "faq-002" },
  { question: "How much is the delivery fee?", expectedSource: "faq", expectedId: "faq-003" },
  { question: "What payment methods do you accept?", expectedSource: "faq", expectedId: "faq-004" },
  { question: "Can I cancel or modify my order after placing it?", expectedSource: "faq", expectedId: "faq-005" },
  { question: "What happens if an item on the menu is unavailable?", expectedSource: "faq", expectedId: "faq-006" },
  { question: "Do you accommodate food allergies or dietary restrictions?", expectedSource: "faq", expectedId: "faq-007" },
  { question: "How can I contact customer support?", expectedSource: "faq", expectedId: "faq-008" },
  { question: "What areas do you deliver to?", expectedSource: "faq", expectedId: "faq-009" },
  { question: "What are your operating hours?", expectedSource: "faq", expectedId: "faq-010" },
  { question: "Can I schedule an order for a later time?", expectedSource: "faq", expectedId: "faq-011" },
  { question: "Do you offer catering or bulk orders?", expectedSource: "faq", expectedId: "faq-012" },
  { question: "What's on the menu?", expectedSource: "faq", expectedId: "faq-013" },
  { question: "What do you recommend? What's your best seller?", expectedSource: "faq", expectedId: "faq-014" },

  { question: "how can I cancel my order?", expectedSource: "faq", expectedId: "faq-005" },
  { question: "what do you have available to eat", expectedSource: "faq", expectedId: "faq-013" },

  { question: "Tell me about the Ginataang Hipon", expectedSource: "product", expectedId: "Ginataang Hipon" },
  { question: "Tell me about the Tofu Sisig", expectedSource: "product", expectedId: "Tofu Sisig" },
  { question: "Tell me about the Pork Adobo", expectedSource: "product", expectedId: "Pork Adobo" },
  { question: "Tell me about the Lumpiang Shanghai", expectedSource: "product", expectedId: "Lumpiang Shanghai" },
  { question: "Tell me about the Special Chicken Adobo", expectedSource: "product", expectedId: "Special Chicken Adobo" },
  { question: "Tell me about the Crispy Lechon Kawali", expectedSource: "product", expectedId: "Crispy Lechon Kawali" },
  { question: "Tell me about the Sizzling Sisig", expectedSource: "product", expectedId: "Sizzling Sisig" },
  { question: "Tell me about the Chicken Curry", expectedSource: "product", expectedId: "Chicken Curry" },
  { question: "Tell me about the Sweet and Spicy Laing", expectedSource: "product", expectedId: "Sweet and Spicy Laing" },

  { question: "I received a wrong order", expectedSource: "faq", expectedId: "faq-001" },
];

async function runTestCase(client: any, tc: TestCase): Promise<{ pass: boolean; ranks: string[] }> {
  const [queryEmbedding] = await embed([tc.question]);

  const { rows } = await client.query(
    `select content, metadata,
            1 - (embedding <=> $1::vector) as similarity
     from documents
     order by embedding <=> $1::vector
     limit $2`,
    [JSON.stringify(queryEmbedding), TOP_K]
  );

  const ranks = rows.map((row: any) => {
    const m = row.metadata ?? {};
    return m.source === "faq" ? m.faq_id : m.name;
  });

  const topSlice = ranks.slice(0, MATCH_WITHIN);
  const pass = topSlice.includes(tc.expectedId);

  return { pass, ranks };
}

async function main() {
  const client = await pool.connect();
  let passed = 0;
  const failures: { tc: TestCase; ranks: string[] }[] = [];

  try {
    for (const tc of TEST_CASES) {
      const { pass, ranks } = await runTestCase(client, tc);
      if (pass) {
        passed++;
      } else {
        failures.push({ tc, ranks });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${TEST_CASES.length} passed\n`);

  if (failures.length > 0) {
    console.log("FAILURES:\n");
    for (const { tc, ranks } of failures) {
      console.log(`Question: "${tc.question}"`);
      console.log(`  Expected: ${tc.expectedId} (within top ${MATCH_WITHIN})`);
      console.log(`  Got top ${TOP_K}: ${ranks.join(", ")}`);
      console.log("---");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Regression test failed to run:", err.message);
  process.exit(1);
});
