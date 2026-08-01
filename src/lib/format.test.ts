import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { axisLabels, holdDuration, money, percent, price, timeAgo } from "./format";

describe("holdDuration", () => {
  it("reports sub-hour spans in minutes", () => {
    assert.equal(holdDuration(6, "5m"), "30m");
    assert.equal(holdDuration(3, "15m"), "45m");
  });

  it("reports intraday spans in hours", () => {
    assert.equal(holdDuration(11, "15m"), "2.8h");
    assert.equal(holdDuration(5, "1h"), "5.0h");
  });

  it("rolls over to trading days past one session", () => {
    // 26 fifteen-minute bars is a full 6.5-hour session, not 6.5/24 of a day.
    assert.equal(holdDuration(26, "15m"), "1.0 days");
    assert.equal(holdDuration(39, "15m"), "1.5 days");
  });

  it("treats daily bars as days directly", () => {
    assert.equal(holdDuration(3, "1D"), "3 days");
    assert.equal(holdDuration(2.5, "1D"), "2.5 days");
  });

  it("counts trading time, not calendar time", () => {
    // Two 4h bars is 8 hours of market — just over one session, however many
    // overnights it spans on the clock.
    assert.equal(holdDuration(2, "4h"), "1.2 days");
  });
});

describe("money", () => {
  it("signs with a true minus and rounds to whole dollars", () => {
    assert.equal(money(3840), "+$3,840");
    assert.equal(money(-212.4), "−$212");
    assert.equal(money(0), "+$0");
  });
});

describe("percent / price", () => {
  it("formats with explicit sign and two decimals", () => {
    assert.equal(percent(2.5), "+2.50%");
    assert.equal(percent(-0.334), "−0.33%");
    assert.equal(price(1018.375), "1,018.38");
  });
});

describe("timeAgo", () => {
  it("scales the unit to the gap", () => {
    const now = 1_700_000_000_000;
    assert.equal(timeAgo(now - 30_000, now), "30s ago");
    assert.equal(timeAgo(now - 120_000, now), "2m ago");
    assert.equal(timeAgo(now - 7_200_000, now), "2h ago");
    assert.equal(timeAgo(now - 172_800_000, now), "2d ago");
  });

  it("never reports negative time from clock skew", () => {
    const now = 1_700_000_000_000;
    assert.equal(timeAgo(now + 5_000, now), "0s ago");
  });
});

describe("axisLabels", () => {
  // 2026-07-30 13:30 UTC = 09:30 ET, the open.
  const open = Math.floor(Date.UTC(2026, 6, 30, 13, 30) / 1000);
  const hour = 3600;
  const day = 86_400;

  it("shows clock time only while the day does not change", () => {
    const labels = axisLabels([open, open + hour, open + 2 * hour], false);
    assert.deepEqual(labels, ["Jul 30 09:30", "10:30", "11:30"]);
  });

  it("re-prefixes the date whenever the day rolls over", () => {
    // Without this, an intraday window spanning sessions reads as though
    // time ran backwards: 15:30 followed by 09:30.
    const labels = axisLabels([open + 6 * hour, open + day, open + day + hour], false);
    assert.equal(labels[0], "Jul 30 15:30");
    assert.equal(labels[1], "Jul 31 09:30");
    assert.equal(labels[2], "10:30");
  });

  it("labels daily bars with dates throughout", () => {
    const labels = axisLabels([open, open + day, open + 2 * day], true);
    assert.deepEqual(labels, ["Jul 30", "Jul 31", "Aug 1"]);
  });
});
