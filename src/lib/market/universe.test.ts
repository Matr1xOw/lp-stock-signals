import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passCount, scanSlice, SCAN_BATCH, UNIVERSE } from "./universe";

/**
 * The desk expires a signal when its symbol was swept and it did not come
 * back, so "swept" has to be a guarantee rather than an approximation. These
 * tests pin the partition property that guarantee rests on.
 */
describe("scanSlice", () => {
  it("covers the whole universe in one cycle of passes", () => {
    const seen = new Set<string>();
    for (let pass = 0; pass < passCount(); pass++) {
      for (const symbol of scanSlice(pass)) seen.add(symbol);
    }
    assert.equal(seen.size, UNIVERSE.length);
  });

  it("never scans the same symbol twice in one cycle", () => {
    const all: string[] = [];
    for (let pass = 0; pass < passCount(); pass++) all.push(...scanSlice(pass));
    assert.equal(all.length, new Set(all).size);
    assert.equal(all.length, UNIVERSE.length);
  });

  it("keeps every slice inside the batch ceiling", () => {
    for (let pass = 0; pass < passCount(); pass++) {
      assert.ok(scanSlice(pass).length <= SCAN_BATCH);
      assert.ok(scanSlice(pass).length > 0);
    }
  });

  it("spreads the load evenly instead of ending on a stub", () => {
    const sizes = Array.from({ length: passCount() }, (_, p) =>
      scanSlice(p).length,
    );
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  });

  it("cycles, so the rotation can count up forever", () => {
    assert.deepEqual(scanSlice(passCount()), scanSlice(0));
    assert.deepEqual(scanSlice(passCount() * 7 + 1), scanSlice(1));
  });

  it("never returns an empty slice, whatever it is handed", () => {
    // An empty slice would sweep nothing and expire nothing, which is safe;
    // an out-of-range one that silently covered no symbols would not be.
    assert.ok(scanSlice(-1).length > 0);
    assert.ok(scanSlice(0, 1).length > 0);
    assert.ok(scanSlice(3, 1_000).length > 0);
  });

  it("degenerates sensibly when the batch holds everything", () => {
    assert.equal(passCount(1_000), 1);
    assert.equal(scanSlice(0, 1_000).length, UNIVERSE.length);
  });
});
