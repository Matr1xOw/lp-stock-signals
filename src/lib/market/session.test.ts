import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionStatus, untilOpen } from "./session";

/**
 * Instants are written as UTC so the tests state an absolute moment rather
 * than trusting the thing under test to interpret them. Eastern time is UTC−4
 * in summer and UTC−5 in winter, which is exactly the arithmetic being
 * checked, so it is spelled out in each case.
 */
const utc = (iso: string) => Date.parse(iso);

describe("sessionStatus", () => {
  it("is open during a summer session", () => {
    // Mon 3 Aug 2026, 10:00 EDT.
    const status = sessionStatus(utc("2026-08-03T14:00:00Z"));
    assert.equal(status.open, true);
    assert.equal(status.nextOpen, null);
    assert.equal(status.closesAt, utc("2026-08-03T20:00:00Z"));
  });

  it("is open during a winter session, an hour further from UTC", () => {
    // Wed 14 Jan 2026, 10:00 EST.
    const status = sessionStatus(utc("2026-01-14T15:00:00Z"));
    assert.equal(status.open, true);
    assert.equal(status.closesAt, utc("2026-01-14T21:00:00Z"));
  });

  it("is shut on the bell in either direction", () => {
    // 09:29 EDT, then 09:30, then 16:00 exactly.
    assert.equal(sessionStatus(utc("2026-08-03T13:29:00Z")).open, false);
    assert.equal(sessionStatus(utc("2026-08-03T13:30:00Z")).open, true);
    assert.equal(sessionStatus(utc("2026-08-03T20:00:00Z")).open, false);
  });

  it("points a pre-market instant at this morning's open", () => {
    // Mon 3 Aug 2026, 07:00 EDT.
    const status = sessionStatus(utc("2026-08-03T11:00:00Z"));
    assert.equal(status.open, false);
    assert.equal(status.nextOpen, utc("2026-08-03T13:30:00Z"));
  });

  it("points an after-hours instant at tomorrow's open", () => {
    // Mon 3 Aug 2026, 17:30 EDT.
    const status = sessionStatus(utc("2026-08-03T21:30:00Z"));
    assert.equal(status.nextOpen, utc("2026-08-04T13:30:00Z"));
  });

  it("skips the weekend", () => {
    // Sat 8 Aug 2026, midday.
    const status = sessionStatus(utc("2026-08-08T16:00:00Z"));
    assert.equal(status.open, false);
    assert.equal(status.nextOpen, utc("2026-08-10T13:30:00Z"));
  });

  it("skips a holiday", () => {
    // Thanksgiving, Thu 26 Nov 2026 — 10:00 EST would otherwise be open.
    const status = sessionStatus(utc("2026-11-26T15:00:00Z"));
    assert.equal(status.open, false);
    assert.equal(status.nextOpen, utc("2026-11-27T14:30:00Z"));
  });

  it("skips a holiday that has swallowed a Friday, landing on Monday", () => {
    // Independence Day observed Fri 3 Jul 2026, after Thursday's close.
    const status = sessionStatus(utc("2026-07-02T21:00:00Z"));
    assert.equal(status.nextOpen, utc("2026-07-06T13:30:00Z"));
  });

  it("closes early on a half-day", () => {
    // Fri 27 Nov 2026, 12:30 EST — open, but only until 13:00.
    const status = sessionStatus(utc("2026-11-27T17:30:00Z"));
    assert.equal(status.open, true);
    assert.equal(status.earlyClose, true);
    assert.equal(status.closesAt, utc("2026-11-27T18:00:00Z"));

    // 13:30 EST is past the early bell, on a day that is not otherwise shut.
    assert.equal(sessionStatus(utc("2026-11-27T18:30:00Z")).open, false);
  });

  it("flags an early close before it arrives", () => {
    // Thu 24 Dec 2026 pre-market: Christmas Eve is a half-day.
    const status = sessionStatus(utc("2026-12-24T12:00:00Z"));
    assert.equal(status.open, false);
    assert.equal(status.earlyClose, true);
    assert.equal(status.nextOpen, utc("2026-12-24T14:30:00Z"));
  });

  it("resolves an open across a DST boundary", () => {
    // Sun 8 Mar 2026 is the spring-forward. From Friday's close the next open
    // is Monday 09:30 EDT — 13:30Z, not the 14:30Z that Friday's offset gives.
    const status = sessionStatus(utc("2026-03-06T22:00:00Z"));
    assert.equal(status.nextOpen, utc("2026-03-09T13:30:00Z"));
  });

  it("resolves an open across the autumn boundary", () => {
    // Sun 1 Nov 2026 is the fall-back: Monday opens at 14:30Z.
    const status = sessionStatus(utc("2026-10-30T21:00:00Z"));
    assert.equal(status.nextOpen, utc("2026-11-02T14:30:00Z"));
  });

  it("falls back to weekday rules past the end of the calendar", () => {
    // 2035 is beyond the holiday table; an ordinary Tuesday still works.
    const status = sessionStatus(utc("2035-08-07T15:00:00Z"));
    assert.equal(status.open, true);
  });
});

describe("untilOpen", () => {
  it("rounds up so it never reads zero while there is a wait", () => {
    assert.equal(untilOpen(1_000), "1m");
    assert.equal(untilOpen(0), "0m");
  });

  it("reports sub-hour waits in minutes", () => {
    assert.equal(untilOpen(44 * 60_000), "44m");
  });

  it("reports intraday waits in hours and minutes", () => {
    assert.equal(untilOpen((2 * 60 + 14) * 60_000), "2h 14m");
    assert.equal(untilOpen(3 * 60 * 60_000), "3h");
  });

  it("drops to a single unit past a day", () => {
    assert.equal(untilOpen((3 * 24 + 4) * 60 * 60_000), "3d 4h");
    assert.equal(untilOpen(2 * 24 * 60 * 60_000), "2d");
  });
});
