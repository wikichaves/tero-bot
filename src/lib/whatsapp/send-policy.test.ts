import test from "node:test";
import assert from "node:assert/strict";
import { inboundEventTime, serviceWindowOpen, mayFallbackLanguage, decodeSendResponse, WhatsAppSendError } from "./send-policy";

const now = Date.parse("2026-09-27T12:00:00Z");
test("window requires a known, recent inbound; rejects boundary, invalid and future timestamps", () => {
  assert.equal(serviceWindowOpen(new Date(now - 3600000).toISOString(), now), true);
  for (const value of [null, "garbage", new Date(now + 1).toISOString(), new Date(now - 86400000).toISOString(), new Date(now - 86340000).toISOString()]) {
    assert.equal(serviceWindowOpen(value, now), false);
  }
});
test("only an explicit missing-language/template rejection permits a second send", () => {
  assert.equal(mayFallbackLanguage(new WhatsAppSendError("missing", 132001)), true);
  for (const error of [new Error("timeout"), new WhatsAppSendError("auth", 190), new WhatsAppSendError("window", 131047), new WhatsAppSendError("limit", 130429)]) {
    assert.equal(mayFallbackLanguage(error), false);
  }
});
test("2xx without a message id is uncertain, never successful", async () => {
  for (const body of ["{}", "not json", '{"messages":[]}']) {
    await assert.rejects(decodeSendResponse(new Response(body)), /acceptance unknown/);
  }
});
test("accepted message keeps provider id; does not assert delivery", async () => {
  const result = await decodeSendResponse(Response.json({ messages: [{ id: "wamid.example" }] }));
  assert.equal(result.messageId, "wamid.example");
});
test("provider error code survives for precise fallback selection", async () => {
  await assert.rejects(decodeSendResponse(Response.json({ error: { code: 132001 } }, { status: 400 })), (error: unknown) => mayFallbackLanguage(error));
  await assert.rejects(decodeSendResponse(new Response("bad gateway", { status: 502 })), (error: unknown) => !mayFallbackLanguage(error));
});

test("late webhook delivery cannot reopen the window; missing Meta timestamp fails closed", () => {
  assert.equal(inboundEventTime({ message: { timestamp: "1790506800" } }), new Date(1790506800000).toISOString());
  assert.equal(inboundEventTime({ message: { timestamp: "2026-09-27T11:00:00Z" } }), "2026-09-27T11:00:00.000Z");
  assert.equal(inboundEventTime({ created_at: new Date(now).toISOString() }), null);
  assert.equal(inboundEventTime({ message: { timestamp: "garbage" } }), null);
  assert.equal(serviceWindowOpen(inboundEventTime({ message: { timestamp: String((now - 90000000) / 1000) } }), now), false);
});
