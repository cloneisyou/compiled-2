# Clone Team Workspace

**Multiplayer AI for teams. Every teammate is always in the room, even when they're not.**

**Track:** YC Request for Startups, Fall 2026: **Multiplayer AI** — teammates join the same live AI session, see the work, steer it, and take it over.

Built at **c0mpiled-18 · YC Startup School Hackathon, Taipei** (Nov 11, 2026) on top of
[Clone](https://clone.is)'s Team workspace.

AI today is single-player: everyone on a team has their own private chat, pastes context
around, and nobody can join or steer anyone else's session. Clone already gives each person a
**Clone**, a model of how they think, that predicts their next prompt. Team Workspace makes it
multiplayer:

| | |
|---|---|
| **One live session** | Teammates join the same AI session: presence, live cursors, one thread, one team plan. |
| **See the work** | The Team AI's replies and the team plan update on every screen the moment they change. |
| **Steer it** | Anyone can send the next prompt into the same session and change its direction. |
| **Take it over** | One click makes you the driver. The Team AI writes you a two-sentence handoff brief. |
| **Pick whose Clone writes the next prompt** | The composer predicts the next prompt. In a team you choose whose Clone predicts it: Clone Min, Clone Jun or Clone Sara each write it the way that person would, even when that person is away. Tab accepts, Tab again sends. |

## Run it

```bash
node server.mjs            # Node 20+, zero dependencies
open "http://127.0.0.1:4317/?as=min&ws=team"   # Min (CEO)
open "http://127.0.0.1:4317/?as=jun&ws=team"   # Jun (Engineer) in a second window
# Sara stays away; her Clone can still write the next prompt.
```

Model: any OpenAI-compatible endpoint, e.g. GMI Cloud inference:

```bash
LLM_BASE_URL=https://api.gmi-serving.com/v1 LLM_API_KEY=... LLM_MODEL=deepseek-ai/DeepSeek-V3.2 node server.mjs
```

Without those variables it uses the local Codex CLI signed in with ChatGPT.

## How it works

- `server.mjs`: zero-dependency Node server. Realtime presence, cursors and room state over
  Server-Sent Events. One model call per prompt returns the Team AI reply, a team-plan item,
  and the next prompt each teammate's Clone would write. `runPredict()` writes those prompts
  on demand; `takeOver()` changes the driver and asks the model for a handoff brief.
- `seed.mjs`: the demo team and each Clone's memory of how its human thinks.
- `public/`: the room UI (vanilla JS). `stage.html` puts two teammates side by side.
- `video/`: `record-real.mjs` records the running app with two teammates (real model calls);
  `public/motion.html` + `capture-mg.mjs` render the demo frame by frame.

## Demo video

`video/clone-team-rooms-demo.mp4` (86 s, 2560x1440). A motion graphic rendered from `public/motion.html`.
The predicted prompt, plan item and handoff brief shown in it are real model output from a take of the
live app. Four segments labelled "Real app · live" (0:31, 0:53, 1:01, 1:13) are screen recordings of the
running app with two teammates side by side; model wait time is cut.
