import assert from "node:assert/strict";
import { test } from "node:test";
import { monthDays } from "../../src/lib/availability/core";
import { validStay, staySummary } from "../../src/app/availability/stay";
const property = { id: "house", known: true };
const days = [...monthDays("2026-12"), ...monthDays("2027-01")];
const rate = { property_id: "house", start_date: "2026-12-01", end_date: "2027-02-01", amount: 200.25, currency: "USD" };
test("cross-year stay excludes checkout and preserves cents", () => {
  const result = staySummary(property, days, [{id:"next",property_id:"house",start_date:"2027-01-02",end_date:"2027-01-04",kind:"reservation"}], [rate], "2026-12-30", "2027-01-02");
  assert.equal(result.status, "available"); assert.equal(result.total, 600.75);
});
test("overlapping block prevents availability", () => {
  assert.equal(staySummary(property, days, [{id:"block",property_id:"house",start_date:"2026-12-31",end_date:"2027-01-01",kind:"block"}], [rate], "2026-12-30", "2027-01-02").status, "block");
});
test("stale or incomplete coverage is never confirmed", () => {
  for (const [p, dates] of [[{...property,known:false},days],[property,monthDays("2026-12")]] as const) {
    const result = staySummary(p, [...dates], [], [rate], "2026-12-30", "2027-01-02");
    assert.equal(result.status, "unknown"); assert.equal(result.total, null);
  }
});
test("missing, mixed-currency and overlapping rates suppress totals", () => {
  for (const rates of [[], [{...rate,end_date:"2027-01-01"}], [{...rate,end_date:"2027-01-01"},{...rate,start_date:"2027-01-01",currency:"UYU"}], [rate,rate]]) {
    assert.equal(staySummary(property, days, [], rates, "2026-12-30", "2027-01-02").total, null);
  }
});
test("invalid dates and oversized ranges rejected", () => {
  for (const [start,end] of [["2026-02-30","2026-03-01"],["2027-01-02","2027-01-01"],["2027-01-01","2027-01-01"],["2027-01-01","2028-01-01"]]) assert.equal(validStay(start,end),false);
  assert.equal(validStay("2026-12-30","2027-01-02"),true);
});
