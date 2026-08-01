export type WooProduct = {
  id: number;
  name: string;
  sku: string;
  price: string;
  stock_status: string;
  short_description: string;
  description: string;
  categories: { id: number; name: string }[];
  permalink: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function fetchAllProducts(): Promise<WooProduct[]> {
  const baseUrl = requireEnv("WOOCOMMERCE_URL").replace(/\/$/, "");
  const consumerKey = requireEnv("WOOCOMMERCE_CONSUMER_KEY");
  const consumerSecret = requireEnv("WOOCOMMERCE_CONSUMER_SECRET");
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const products: WooProduct[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const url = `${baseUrl}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=publish`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      throw new Error(
        `WooCommerce request failed: ${res.status} ${await res.text()}`
      );
    }

    const batch = (await res.json()) as WooProduct[];
    products.push(...batch);

    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }

  return products;
}
