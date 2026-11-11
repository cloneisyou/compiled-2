# Clone Team Workspace

**Multiplayer AI for teams. Every teammate is always in the room, even when they're not.**

**Track:** YC Request for Startups, Fall 2026: **Multiplayer AI** — teammates join the same live AI session, see the work, steer it, and take it over.

Built at **c0mpiled-18 · YC Startup School Hackathon, Taipei** (Nov 11, 2026) on top of
[Clone](https://clone.is)'s Team workspace.

AI today is single-player: everyone on a team has their own private chat, pastes context
around, and still waits for meetings to decide anything. Clone already gives each person a
**Clone**, a model of how they think and decide. Team Workspace makes it multiplayer:

| | |
|---|---|
| **One shared Team AI** | Humans talk to the same AI in a realtime room. It knows who is speaking, who is here, and the team goal and plan. |
| **Clones stand in** | When a teammate is away, their Clone answers in their voice, with a confidence score. `@Sara` works even when Sara is asleep. |
| **Team Clone Mode** | Every proposal is scored by each teammate's Clone: *how likely is my human to accept this?* If every Clone is above the bar (75%), it ships immediately and lands in the team plan. No meeting. |
| **Ask only the dissenters** | If a Clone predicts its human would object, only that human is pinged, with Approve / Reject right in the room. |
| **Humans keep the final say** | Anyone can Revert. When a human overrides their Clone, the Clone **learns** the correction and uses it on the next prediction. |

This is Clone's "forgiveness over permission" Clone Mode, extended from one person to a whole
team: the AI predicts the *team's* acceptance, not just yours.

## Run it

```bash
node server.mjs            # Node 20+, zero dependencies
open "http://127.0.0.1:4317/?as=min"   # Min (CEO)
open "http://127.0.0.1:4317/?as=jun"   # Jun (Engineer) in a second window
# Sara stays away, so Clone Sara stands in for her.
```

Model: any OpenAI-compatible endpoint, e.g. GMI Cloud inference:

```bash
LLM_BASE_URL=https://api.gmi-serving.com/v1 LLM_API_KEY=... LLM_MODEL=deepseek-ai/DeepSeek-V3.2 node server.mjs
```

Without those variables it uses the local Codex CLI signed in with ChatGPT.

## How it works

- `server.mjs`: zero-dependency Node server. Realtime presence and room state over
  Server-Sent Events. One model call per message returns the Team AI reply, stand-in replies
  from away teammates' Clones, a proposal, and a per-teammate acceptance prediction.
  `settle()` implements Team Clone Mode; `vote()` records human overrides as Clone lessons.
- `seed.mjs`: the demo team and each Clone's memory of how its human thinks.
- `public/`: the room UI (vanilla JS). `stage.html` puts two teammates side by side for the demo.
- `video/record.mjs` + `video/cut.mjs`: records the demo against the live server with real
  model calls (Playwright), then cuts only the model wait time.

## Demo video

`video/clone-team-rooms-demo.mp4` (86 s, 2560x1440). It is a motion graphic rendered frame by frame from
`public/motion.html` (`node video/capture-mg.mjs`). The Clone replies, vote predictions and the predicted
prompt shown in it are real model output from takes of the live app (`node video/record.mjs`).
Two segments (0:31 and 1:15, labelled "Real app · live") are screen recordings of the running app with
two teammates side by side (`public/stage.html`, `node video/record-real.mjs`).
