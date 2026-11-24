import test from "node:test";
import assert from "node:assert/strict";
import { isPasswordRecoveryRequest, validRecoveryInput } from "./password-recovery-policy";

test("only explicit recovery commands, never another phone or quoted instruction", () => {
  for (const body of ["recuperar contraseña", "/recuperar contrasena", "RESET PASSWORD", " recuperar password "]) assert.equal(isPasswordRecoveryRequest(body), true);
  for (const body of [null, "", "recuperar contraseña +59899123456", "quiero recuperar contraseña", "reset password for admin", "recuperar contraseña\nfoo"]) assert.equal(isPasswordRecoveryRequest(body), false);
});
test("recovery proof is mandatory and credentials are bounded before token consumption", () => {
  for (const token of ["a".repeat(56), "a".repeat(64), "pkce_" + "a".repeat(56)]) assert.equal(validRecoveryInput(token, "long password 123"), true);
  for (const token of [null, {}, "", "short", "a".repeat(257), "https://evil.test/token", "a".repeat(64)+"\n"]) assert.equal(validRecoveryInput(token, "long password 123"), false);
  for (const password of [null, {}, "short", "a".repeat(129)]) assert.equal(validRecoveryInput("a".repeat(64), password), false);
});
