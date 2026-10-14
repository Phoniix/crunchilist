// AniList GraphQL, pacing itself by AniList's rate-limit headers and waiting out Retry-After.
const ENDPOINT = "https://graphql.anilist.co";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function anilist(query, variables = {}, { token = "", fetchImpl = fetch, retries = 3 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429 && attempt < retries) {
      await sleep((Number(response.headers.get("retry-after")) || 30) * 1000 + 250);
      continue;
    }
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 400 && /invalid token/i.test(JSON.stringify(body?.errors || ""))) {
      const error = new Error("Your AniList sign-in has expired. Connect AniList again.");
      error.code = "auth";
      throw error;
    }
    if (!response.ok || body?.errors?.length) throw new Error(body?.errors?.[0]?.message || `AniList answered ${response.status}`);
    if (Number(response.headers.get("x-ratelimit-remaining")) <= 2) await sleep(2000);
    return body.data;
  }
}

export const VIEWER_QUERY = "query { Viewer { id name avatar { medium } } }";
