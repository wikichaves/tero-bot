"use server";

import { createClient } from "@supabase/supabase-js";
import { validRecoveryInput } from "@/lib/auth/password-recovery-policy";

export async function resetPassword(input: { token: string; password: string }) {
  if (!input || !validRecoveryInput(input.token, input.password)) return { error: "invalid" };
  // Isolated anon client: do not create a browser login before the password is saved.
  // In particular, an existing logged-in session cannot replace recovery proof.
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.verifyOtp({ token_hash: input.token, type: "recovery" });
  if (error || !data.session) return { error: "expired" };
  const { error: updateError } = await client.auth.updateUser({ password: input.password });
  // Also revoke other refresh sessions after a successful credential change.
  await client.auth.signOut({ scope: updateError ? "local" : "global" });
  if (updateError) return { error: "failed" };
  return { success: true };
}
