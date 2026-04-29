import { createHash, randomBytes } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const KEY_PREFIX = "wmk_";

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) return null;
  return parts[1];
}

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export interface AuthedRequest {
  userId: string;
  keyId: string;
}

// Returns the authed user (by api_key) or null. Updates last_used_at on
// success (fire-and-forget).
export async function authenticateApiKey(rawKey: string | null): Promise<AuthedRequest | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(rawKey);
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  void admin()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return { userId: data.user_id, keyId: data.id };
}
