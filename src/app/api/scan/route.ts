import { DEFAULT_MIN_CONFIDENCE, scan } from "@/lib/signals/engine";
import { isTimeframe } from "@/lib/market/types";

/**
 * Sweeps a slice of the universe and returns qualifying signals.
 *
 * Query parameters:
 *   timeframe      one of 5m | 15m | 1h | 4h | 1D  (default 15m)
 *   pass           which slice of the universe to sweep (default 0)
 *   minConfidence  confidence floor, 0–100
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const timeframe = params.get("timeframe") ?? "15m";
  if (!isTimeframe(timeframe)) {
    return Response.json(
      { error: `Unsupported timeframe: ${timeframe}` },
      { status: 400 },
    );
  }

  const pass = Number.parseInt(params.get("pass") ?? "0", 10);
  const rawFloor = params.get("minConfidence");
  const minConfidence =
    rawFloor === null ? DEFAULT_MIN_CONFIDENCE : Number(rawFloor);

  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) {
    return Response.json(
      { error: "minConfidence must be between 0 and 100" },
      { status: 400 },
    );
  }

  try {
    const result = await scan({
      timeframe,
      pass: Number.isFinite(pass) && pass >= 0 ? pass : 0,
      minConfidence,
    });
    return Response.json(result);
  } catch (error) {
    // Upstream throttling is the expected failure here, and the dashboard
    // handles it by keeping the previous scan on screen.
    const message =
      error instanceof Error ? error.message : "Scan failed unexpectedly";
    return Response.json({ error: message }, { status: 502 });
  }
}
