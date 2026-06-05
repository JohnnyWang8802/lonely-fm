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

export const sendEmailCode = async (email: string): Promise<void> => {
  if (!supabase) throw new Error("Supabase 尚未配置");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) throw error;
};

export const verifyEmailCode = async (email: string, token: string): Promise<Session> => {
  if (!supabase) throw new Error("Supabase 尚未配置");
  const signupResult = await supabase.auth.verifyOtp({ email, token, type: "signup" });
  if (signupResult.data.session) return signupResult.data.session;

  const emailResult = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (emailResult.error) throw emailResult.error;
  if (!emailResult.data.session) throw signupResult.error ?? new Error("登录成功但未创建会话");
  return emailResult.data.session;
};
