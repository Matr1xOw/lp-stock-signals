import { isTimeframe } from "@/lib/market/types";
import { getSeries } from "@/lib/market/yahoo";

/** Bars for one symbol at one timeframe, for the chart panel. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const symbol = params.get("symbol")?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.^-]{1,12}$/.test(symbol)) {
    return Response.json({ error: "A valid symbol is required" }, { status: 400 });
  }

  const timeframe = params.get("timeframe") ?? "15m";
  if (!isTimeframe(timeframe)) {
    return Response.json(
      { error: `Unsupported timeframe: ${timeframe}` },
      { status: 400 },
    );
  }

  try {
    return Response.json(await getSeries(symbol, timeframe));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load candles";
    return Response.json({ error: message }, { status: 502 });
  }
}
