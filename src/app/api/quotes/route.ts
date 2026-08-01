import { getQuotes } from "@/lib/market/yahoo";

/** Most journal refreshes only need last prices, not whole bar series. */
const MAX_SYMBOLS = 50;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";

  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9.^-]{1,12}$/.test(s)),
    ),
  );

  if (symbols.length === 0) return Response.json({ quotes: [] });
  if (symbols.length > MAX_SYMBOLS) {
    return Response.json(
      { error: `At most ${MAX_SYMBOLS} symbols per request` },
      { status: 400 },
    );
  }

  try {
    return Response.json({ quotes: await getQuotes(symbols) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load quotes";
    return Response.json({ error: message }, { status: 502 });
  }
}
