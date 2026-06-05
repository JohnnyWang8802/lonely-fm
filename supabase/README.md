# Supabase 云端记忆启用步骤

1. 在 Supabase 创建项目。
2. 打开 SQL Editor，执行 `migrations/20260604_create_memories.sql`。
3. 在 Authentication > Providers 启用 Google；需要时再启用 Apple。
4. 在 Authentication > URL Configuration 添加本地和线上回调地址：
   - `http://localhost:5173/talk`
   - 正式部署域名的 `/talk`
5. 将 Project URL 和 anon public key 写入项目根目录 `.env`：

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

不要把 Supabase `service_role` key 放入前端或提交到代码库。

启用后，后端会验证 Supabase access token，并通过 RLS 只读写当前登录用户的记忆。
云端不可用时，聊天和本地记忆仍可继续工作。
