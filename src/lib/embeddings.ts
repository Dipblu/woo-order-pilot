const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!res.ok) {
    throw new Error(
      `OpenAI embeddings request failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    results.push(...(await embedBatch(batch)));
  }
  return results;
}
