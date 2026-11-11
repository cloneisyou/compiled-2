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
| **One shared session** | Teammates join the same live AI session: presence, live cursors, one thread, one team plan. Anyone can see the work, steer it, or take it over. |
| **Pick whose Clone writes the next prompt** | The composer predicts the next prompt. In a team you choose whose Clone predicts it: Clone Min, Clone Jun or Clone Sara each write it the way that person would. Tab accepts, Tab again sends. |
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
# Sara stays away; her Clone can still write prompts and vote for her.
```

Model: any OpenAI-compatible endpoint, e.g. GMI Cloud inference:

```bash
LLM_BASE_URL=https://api.gmi-serving.com/v1 LLM_API_KEY=... LLM_MODEL=deepseek-ai/DeepSeek-V3.2 node server.mjs
```

Without those variables it uses the local Codex CLI signed in with ChatGPT.

## How it works

- `server.mjs`: zero-dependency Node server. Realtime presence, cursors and room state over
  Server-Sent Events. One model call per message returns the Team AI reply, a proposal, a
  per-teammate acceptance prediction, and the next prompt each teammate's Clone would write.
  `runPredict()` writes those prompts on demand, `settle()` implements Team Clone Mode, and
  `vote()` records human overrides as Clone lessons.
- `seed.mjs`: the demo team and each Clone's memory of how its human thinks.
- `public/`: the room UI (vanilla JS). `stage.html` puts two teammates side by side.
- `video/`: `record-real.mjs` records the running app with two teammates (real model calls);
  `public/motion.html` + `capture-mg.mjs` render the demo frame by frame.

## Demo video

`video/clone-team-rooms-demo.mp4` (86 s, 2560x1440). A motion graphic rendered from `public/motion.html`.
The predicted prompt, votes and reasons shown in it are real model output from a take of the live app,
and three segments labelled "Real app · live" (0:31, 1:01, 1:15) are screen recordings of the running
app with two teammates side by side.
