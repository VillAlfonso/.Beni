const UA = "BeniRP/0.1 (personal fan archive project)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiGet(base: string, params: Record<string, string>): Promise<any> {
  const url = new URL(base);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (attempt + 1) * (attempt + 1));
    }
  }
  throw lastErr;
}

/** All non-redirect main-namespace page titles. */
export async function listAllPages(apiBase: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  do {
    const data = await apiGet(apiBase, {
      action: "query",
      list: "allpages",
      aplimit: "500",
      apnamespace: "0",
      apfilterredir: "nonredirects",
      ...(cont ? { apcontinue: cont } : {})
    });
    for (const p of data.query.allpages) titles.push(p.title);
    cont = data.continue?.apcontinue;
    await sleep(350);
  } while (cont);
  return titles;
}

export interface RawPage {
  title: string;
  wikitext: string;
}

/** Fetch raw wikitext for many titles (batched 50 per request). */
export async function fetchPages(apiBase: string, titles: string[]): Promise<RawPage[]> {
  const out: RawPage[] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await apiGet(apiBase, {
      action: "query",
      prop: "revisions",
      rvslots: "main",
      rvprop: "content",
      titles: batch.join("|")
    });
    for (const p of data.query.pages ?? []) {
      const content = p.revisions?.[0]?.slots?.main?.content;
      if (typeof content === "string") out.push({ title: p.title, wikitext: content });
    }
    process.stdout.write(`\r  fetched ${Math.min(i + 50, titles.length)}/${titles.length} pages   `);
    await sleep(350);
  }
  process.stdout.write("\n");
  return out;
}

/** Resolve File: titles to direct URLs (batched). */
export async function fetchImageUrls(apiBase: string, fileTitles: string[]): Promise<{ title: string; url: string }[]> {
  const out: { title: string; url: string }[] = [];
  for (let i = 0; i < fileTitles.length; i += 50) {
    const batch = fileTitles.slice(i, i + 50);
    const data = await apiGet(apiBase, {
      action: "query",
      prop: "imageinfo",
      iiprop: "url",
      titles: batch.join("|")
    });
    for (const p of data.query.pages ?? []) {
      const url = p.imageinfo?.[0]?.url;
      if (url) out.push({ title: p.title, url });
    }
    await sleep(350);
  }
  return out;
}

export async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
