import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")?.trim()
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!url || !key) throw new Error("Supabase service role is not configured")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createUserClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")?.trim()
  const anon = Deno.env.get("SUPABASE_ANON_KEY")?.trim()
  if (!url || !anon) throw new Error("Supabase anon client is not configured")
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireUserId(req: Request): Promise<{ userId: string; authHeader: string }> {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing authorization")
  }
  const userClient = createUserClient(authHeader)
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) throw new Error("Unauthorized")
  return { userId: data.user.id, authHeader }
}
