# Lonely FM（在吗）

Lonely FM is an AI for Good voice companion web app for lonely moments. The MVP is a pure web experience: users press and hold to speak, the backend streams emotion/transcript/AI response events over WebSocket, and the interface presents a calm “late-night radio” companion named 阿晚.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS v3, Zustand, React Router
- Backend: Python 3.11, FastAPI, WebSocket, Redis/PostgreSQL-ready service boundaries
- AI services: Gemma 4, Google Cloud TTS, MiniMax Speech 2.8, Hume/Fish-ready service boundaries

## Quick Start

```bash
cp .env.example .env
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

Without API keys or a running local model, the backend runs in demo fallback mode so the core WebSocket flow and UI can still be tested.

## Local Gemma

By default the project is configured for local Gemma:

```env
GEMMA_PROVIDER=local
GEMMA_MODEL=gemma4:12b-mlx
LOCAL_GEMMA_PROVIDER=ollama
LOCAL_GEMMA_BASE_URL=http://127.0.0.1:11434
```

For LM Studio, vLLM, or any OpenAI-compatible local server:

```env
GEMMA_PROVIDER=local
LOCAL_GEMMA_PROVIDER=openai
LOCAL_GEMMA_BASE_URL=http://127.0.0.1:1234
GEMMA_MODEL=your-local-model-id
```

Current hackathon demo target:

- `gemma4:12b-mlx`: local Ollama Gemma 4 model for Apple Silicon demo machines.

## Deployment Strategy

Lonely FM is designed to support two production-facing Gemma paths:

1. **Local Gemma mode first**: the web app can connect to a backend that talks to the user's local Ollama/Gemma 4 runtime. This keeps sensitive companion conversations closer to the user and lowers long-term inference cost.
2. **Cloud Gemma API option**: users who cannot run a local model, especially mobile users, can switch to a cloud Gemma 4 API path when configured.

For a fast web preview:

- Deploy the frontend from `frontend/` to Vercel.
- Deploy or expose the FastAPI backend separately.
- Set Vercel environment variables:

```env
VITE_API_BASE_URL=https://your-backend-domain
VITE_WS_BASE_URL=wss://your-backend-domain
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

For local backend preview with Vercel or a static frontend, keep the backend running locally and point those values to a secure tunnel or local development URL.

The frontend includes a `/setup` step before voice selection. It checks the tester's own machine for Ollama at `http://127.0.0.1:11434/api/tags` and accepts any local model whose tag starts with `gemma4`, such as `gemma4:latest` or `gemma4:12b-mlx`. When testing from the Vercel HTTPS site, Ollama must allow the production origin first:

```bash
launchctl setenv OLLAMA_ORIGINS "https://lonely-fm.vercel.app,http://localhost:5173,http://127.0.0.1:5173"
```

After setting the origin, quit and reopen Ollama, then run `ollama pull gemma4:latest` if no Gemma 4 model is installed. The `/setup` page also keeps a cloud Gemma API key option for testers who do not have a local model.

## Emotion Recognition

Lonely FM uses Hume Expression Measurement when `HUME_API_KEY` is configured:

```env
HUME_API_KEY=your-hume-personal-api-key
HUME_STREAM_URL=wss://api.hume.ai/v0/stream/models
```

The backend sends the user's recognized Chinese text to Hume's streaming emotional language model, then maps Hume's expression scores into the app's demo states: `calm`, `sadness`, `fatigue`, `joy`, `anxiety`, and `crisis`. If Hume is unavailable, the app falls back to local prosody + text heuristics.

Note: Hume has announced Expression Measurement sunset dates in 2026. For this hackathon demo it is still a fast emotion-recognition bridge; keep the service boundary isolated so it can later be replaced by Hume EVI or another prosody model.

## Hume Replacement Path

The default non-Hume path is now `local-prosody`: the browser computes turn-level acoustic features such as average level, peak level, speech duration, trailing silence, and character rate, then sends them with the transcript. The backend combines those prosody metrics with Chinese text signals to infer the app emotion state. This keeps the demo independent from the sunset Expression Measurement API while preserving the “it listens to how I said it” story.

For production, replace `services/hume.py` behind the same `analyze(text, prosody)` interface with one of:

- Hume EVI, if Mandarin support fits the product.
- A hosted speech emotion recognition model that accepts short audio windows.
- A local openSMILE / wav2vec-style prosody classifier running near the backend.

## Emotional Voice Layer

The current local prototype can run with Google Cloud TTS:

```env
TTS_PROVIDER=google
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-tts-service-account.json
GOOGLE_TTS_VOICE=cmn-CN-Chirp3-HD-Aoede
```

For a more natural Mandarin demo, use MiniMax Speech 2.8 after creating an API key:

```env
TTS_PROVIDER=minimax
MINIMAX_API_KEY=your-minimax-api-key
MINIMAX_TTS_WS_ENDPOINT=wss://api.minimax.io/ws/v1/t2a_v2
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE_ID="Chinese (Mandarin)_Warm_Bestie"
```

The backend maps Lonely FM emotion states to MiniMax voice speed, pitch, breath/interjection tags, and short pause markers. When MiniMax is selected, the app uses MiniMax's WebSocket TTS path and sends audio chunks to the browser audio queue as they arrive, before falling back to Google TTS if MiniMax is not configured. The frontend also caches the latest returned audio chunks, so the Replay button replays the original generated voice instead of re-synthesizing with the browser.

Minimum key setup for the current demo:

```env
HUME_API_KEY=...
MINIMAX_API_KEY=...
TTS_PROVIDER=minimax
```

## Demo Scenario

1. Open the app on desktop or mobile.
2. Press and hold the central voice button.
3. Say “今天好累” or use browser speech recognition where supported.
4. Lonely FM shows emotion, transcript, and 阿晚’s short FM-style response.

## Safety Boundary

Lonely FM does not diagnose or replace therapy. It provides short, low-pressure companionship and crisis-aware guidance. High-risk expressions are routed to a safety response instead of ordinary companionship.
