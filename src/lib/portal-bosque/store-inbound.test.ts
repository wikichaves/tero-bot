import assert from "node:assert/strict";
import test from "node:test";

import { wikibotInboundRow, wikibotMessageId } from "./store-inbound";

test("uses Postmark MessageID when present", () => {
  assert.equal(wikibotMessageId({ MessageID: " postmark-123 " }), "postmark-123");
});

test("creates a deterministic fallback id", () => {
  const body = { From: "a@example.com", To: "wikibot@inbound.tero.bot", Subject: "Hola", TextBody: "Texto" };
  assert.equal(wikibotMessageId(body), wikibotMessageId(body));
  assert.match(wikibotMessageId(body), /^sha256:[a-f0-9]{64}$/);
});

test("stores attachment metadata without attachment contents", () => {
  const row = wikibotInboundRow({
    FromFull: { Email: "wiki@example.com", Name: "Wiki" },
    To: "wikibot@inbound.tero.bot",
    Subject: "Prueba",
    TextBody: "Mensaje",
    Attachments: [{
      Name: "archivo.txt",
      Content: "secret-base64",
      ContentType: "text/plain",
      ContentLength: 12,
    }],
  });

  assert.equal(row.from_email, "wiki@example.com");
  assert.equal(row.to_email, "wikibot@inbound.tero.bot");
  assert.deepEqual(row.attachment_metadata, [{
    name: "archivo.txt",
    content_type: "text/plain",
    content_length: 12,
    content_id: null,
  }]);
  assert.equal("Content" in row.attachment_metadata[0], false);
});
