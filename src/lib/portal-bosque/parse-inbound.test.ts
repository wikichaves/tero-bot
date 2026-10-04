import assert from "node:assert/strict";
import { parseWikibotInbound } from "./parse-inbound";

assert.deepEqual(parseWikibotInbound({
  HtmlBody: '<a href="https://www.portalbosque.com/confirmar-asistencia?token=abc&amp;x=1">Confirmar</a>',
}), {
  kind: "portal_bosque",
  actionUrl: "https://www.portalbosque.com/confirmar-asistencia?token=abc&x=1",
});

assert.deepEqual(parseWikibotInbound({
  From: "forwarding-noreply@google.com",
  Subject: "Gmail Forwarding Confirmation",
  TextBody: "https://mail-settings.google.com/mail/vf-abc",
}), {
  kind: "gmail_forwarding",
  actionUrl: "https://mail-settings.google.com/mail/vf-abc",
});

assert.equal(parseWikibotInbound({
  From: "attacker@example.com",
  Subject: "Gmail Forwarding Confirmation",
  TextBody: "https://evil.example/steal",
}).kind, "unknown");

console.log("portal bosque inbound parser: ok");
