import assert from "node:assert/strict";
import test from "node:test";
import {
  belongsToConfiguredPhoneNumber,
  extractKapsoErrors,
  normalizeKapsoStatus,
  verifyKapsoSignature,
} from "./webhook";

test("verifies Kapso HMAC signatures without accepting a different digest", () => {
  const body = '{"data":[]}';
  const signature = "55c34c3c1880177121084ec8e7f244a854367a9c61713b649544e18ac20d7996";
  assert.equal(verifyKapsoSignature(body, signature, "test-secret"), true);
  assert.equal(verifyKapsoSignature(body, "00".repeat(32), "test-secret"), false);
});

test("normalizes Kapso flat delivery events", () => {
  const status = normalizeKapsoStatus(
    { message: { id: "wamid.123", to: "59842772169" } },
    "whatsapp.message.failed",
  );
  assert.deepEqual(status, {
    id: "wamid.123",
    status: "failed",
    recipient_id: "59842772169",
    errors: undefined,
  });
});

test("finds errors nested in a Kapso failure payload", () => {
  assert.deepEqual(
    extractKapsoErrors({ context: { error: { code: 131026 } } }),
    [{ code: 131026 }],
  );
});

test("accepts unlabelled events but rejects a configured different number", () => {
  const previous = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "configured-number";
  assert.equal(belongsToConfiguredPhoneNumber({}), true);
  assert.equal(
    belongsToConfiguredPhoneNumber({ phone_number_id: "configured-number" }),
    true,
  );
  assert.equal(
    belongsToConfiguredPhoneNumber({ phone_number_id: "another-number" }),
    false,
  );
  if (previous === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  else process.env.WHATSAPP_PHONE_NUMBER_ID = previous;
});
