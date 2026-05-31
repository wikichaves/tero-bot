import { createAdminClient } from "@/lib/supabase/admin";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { formatPropertyList } from "@/lib/whatsapp/templates";
import type { Profile } from "@/lib/types";

type WelcomeProfile = Pick<
  Profile,
  "id" | "full_name" | "email" | "whatsapp" | "language" | "role"
>;

export type WelcomeContent = {
  firstName: string;
  propertyList: string;
  language: "es" | "en";
};

/**
 * Resolve the personalized pieces of the staff welcome — first name and the
 * formatted list of properties in scope — shared by the admin template send
 * (`sendStaffWelcome`) and the inbound session-message reply (the `activate`
 * keyword in the webhook). Keeping it in one place means both paths greet the
 * operator with the same name + property scope.
 */
export async function buildWelcomeContent(
  profile: WelcomeProfile,
): Promise<WelcomeContent> {
  const language: "es" | "en" = profile.language === "en" ? "en" : "es";

  const firstName =
    profile.full_name?.trim().split(/\s+/)[0] ??
    profile.email?.split("@")[0] ??
    profile.whatsapp ??
    "";

  const admin = createAdminClient();
  const allowedIds = await getAllowedPropertyIds({
    id: profile.id,
    role: profile.role as "admin" | "gestor" | "mantenimiento",
  });
  let propertyNames: string[] = [];
  if (allowedIds === null) {
    // admin → todas las properties
    const { data } = await admin
      .from("properties")
      .select("name")
      .order("name", { ascending: true });
    propertyNames = (data ?? []).map((r) => r.name as string);
  } else if (allowedIds.length > 0) {
    const { data } = await admin
      .from("properties")
      .select("name")
      .in("id", allowedIds)
      .order("name", { ascending: true });
    propertyNames = (data ?? []).map((r) => r.name as string);
  }
  const propertyList = formatPropertyList(propertyNames, language);

  return { firstName, propertyList, language };
}
