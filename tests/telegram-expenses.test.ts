import assert from "node:assert/strict";
import test from "node:test";
import { parseExpense } from "../src/lib/expenses/parse";
import { telegramExpenseInput } from "../src/lib/expenses/telegram-input";
import type { TelegramMessage } from "../src/lib/telegram";
const msg = (extra: Partial<TelegramMessage> = {}): TelegramMessage => ({ message_id: 42, date: 1, chat: { id: 123, type: "private" }, ...extra });

test("full amounts, currencies and regional separators", () => {
  for (const amount of ["1500", "1.500", "1,500", "1500,50", "1.500,50", "1,500.50"]) {
    const parsed = parseExpense(`gasto Ferretería UYU ${amount}`);
    assert.equal(parsed.amount, amount.endsWith("50") ? 1500.5 : 1500);
    assert.equal(parsed.vendor, "Ferretería");
    assert.equal(parsed.category, "ferreteria");
  }
  assert.equal(parseExpense("Ancap USD 120").currency, "USD");
  assert.equal(parseExpense("Ancap US$ 120").currency, "USD");
  assert.equal(parseExpense(null).amount, null);
});
test("slash, bare command, mention, and Subir gasto", () => {
  for (const text of ["gasto Ancap UYU 1500", "/gasto Ancap UYU 1500", "/gasto@tero_ops_bot Ancap UYU 1500", "Subir gasto Ancap UYU 1500"]) {
    assert.equal(telegramExpenseInput(msg({ text }))?.text, "Ancap UYU 1500");
  }
  assert.equal(telegramExpenseInput(msg({ text: "Subir gasto" }))?.text, "");
  assert.equal(telegramExpenseInput(msg({ text: "/estado" })), null);
});
test("caption and largest photo; photo-only drafts limited to DM", () => {
  const photo = [{ file_id: "small", width: 90, height: 90 }, { file_id: "big", width: 800, height: 800 }];
  assert.equal(telegramExpenseInput(msg({ photo, caption: "gasto Ancap UYU 1500" }))?.attachment?.fileId, "big");
  assert.equal(telegramExpenseInput(msg({ photo }))?.text, "");
  assert.equal(telegramExpenseInput(msg({ photo, chat: { id: -123, type: "supergroup" } })), null);
  assert.equal(telegramExpenseInput(msg({ photo, caption: "/incidente agua" })), null);
  assert.ok(telegramExpenseInput(msg({ photo, caption: "/gasto Ancap UYU 1500", chat: { id: -123, type: "supergroup" } })));
});
test("PDF allowed; unsupported document reported", () => {
  assert.equal(telegramExpenseInput(msg({ document: { file_id: "pdf", mime_type: "application/pdf" } }))?.attachment?.mime, "application/pdf");
  assert.equal(telegramExpenseInput(msg({ text: "/gasto", document: { file_id: "exe", mime_type: "application/octet-stream" } }))?.unsupported, true);
});
test("dedupe key includes chat and message but not sender or caption", () => {
  assert.equal(telegramExpenseInput(msg({ text: "gasto Ancap UYU 1500" }))?.sourceMessageId, "telegram:123:42");
  assert.notEqual(telegramExpenseInput(msg({ text: "gasto", chat: { id: -456, type: "group" } }))?.sourceMessageId, "telegram:123:42");
});
