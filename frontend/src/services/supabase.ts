import { createClient, type Session } from "@supabase/supabase-js";
import type { AuthProfile } from "../types";

const fallbackSupabaseUrl = "https://rerptedbzlgdkprtmwgw.supabase.co";
const fallbackSupabaseAnonKey = "sb_publishable_5QBL2--xincShNYGZ-KIKg_yvIiWFlh";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallbackSupabaseUrl;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || fallbackSupabaseAnonKey;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = supabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export const profileFromSession = (session: Session): AuthProfile => ({
  id: session.user.id,
  email: session.user.email,
  name:
    String(session.user.user_metadata.full_name || session.user.user_metadata.name || "").trim() ||
    session.user.email?.split("@")[0] ||
    "朋友",
  provider: "email",
  signedInAt: new Date().toISOString(),
  accessToken: session.access_token
});

export const sendLoginEmail = async (email: string): Promise<void> => {
  if (!supabase) throw new Error("Supabase 尚未配置");
  const emailRedirectTo =
    typeof window === "undefined" ? undefined : `${window.location.origin}/setup`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo }
  });
  if (error) throw error;
};
