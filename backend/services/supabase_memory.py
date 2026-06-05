from __future__ import annotations

from typing import Any

import httpx

from config import get_settings


class SupabaseMemoryService:
    async def verify_user(self, access_token: str) -> str | None:
        settings = get_settings()
        if not settings.supabase_configured or not access_token:
            return None
        response = await self._request("GET", "/auth/v1/user", access_token)
        return str(response.get("id") or "") or None

    async def list_memories(self, access_token: str) -> list[dict[str, Any]]:
        result = await self._request(
            "GET",
            "/rest/v1/memories?select=id,text,category,source,created_at,updated_at&order=updated_at.desc.nullslast,created_at.desc&limit=24",
            access_token,
        )
        return result if isinstance(result, list) else []

    async def upsert_memory(
        self,
        access_token: str,
        user_id: str,
        memory: dict[str, Any],
    ) -> None:
        payload = {
            "id": memory["id"],
            "user_id": user_id,
            "text": memory["text"],
            "category": memory.get("category"),
            "source": memory.get("source", "manual"),
        }
        await self._request(
            "POST",
            "/rest/v1/memories?on_conflict=id",
            access_token,
            json=payload,
            extra_headers={"Prefer": "resolution=merge-duplicates"},
        )

    async def delete_memory(self, access_token: str, memory_id: str) -> None:
        await self._request("DELETE", f"/rest/v1/memories?id=eq.{memory_id}", access_token)

    async def _request(
        self,
        method: str,
        path: str,
        access_token: str,
        *,
        json: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("Supabase is not configured")
        headers = {
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            **(extra_headers or {}),
        }
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(
                method,
                f"{settings.supabase_url.rstrip('/')}{path}",
                headers=headers,
                json=json,
            )
            response.raise_for_status()
            if not response.content:
                return {}
            return response.json()


supabase_memory_service = SupabaseMemoryService()
