/** Exact commands only: never treat a phone supplied in the body as identity. */
export function isPasswordRecoveryRequest(body: string | null | undefined): boolean {
  return /^(?:\/?recuperar (?:contrase[nñ]a|password)|\/?reset password)$/i.test(body?.trim() ?? "");
}

export function validRecoveryInput(token: unknown, password: unknown): boolean {
  return typeof token === "string" && token.trim() === token && /^[a-zA-Z0-9_-]{32,256}$/.test(token) &&
    typeof password === "string" && password.length >= 12 && password.length <= 128;
}
