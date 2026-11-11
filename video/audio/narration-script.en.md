# Clone Team Workspace — narration (en), source of truth

Voice: same as the clone.is product demo (r188 line): ElevenLabs "Clone Sovereign · Cinematic Bass"
(voice_id Cs2A0WJ8SGAgnpkXfsqm), model `eleven_v4`, stability 0.5, similarity_boost 0.75,
tag `[confident]`, output `pcm_48000`. One generation for the whole script, cut into cues.
Pacing target ~2.5 words/s; each line starts 0.3–1.0 s after its scene starts; ~1 s air at scene end.

| Scene | Time (s) | Line | Words | Est. speech (s) |
|---|---|---|---|---|
| S1 open | 0–7 | This is Clone's team workspace. One goal, one AI, and your whole team in the room. | 16 | ~5.8 |
| S2 live | 7–17 | Jun joins live. Everyone works in the same room, in real time. | 12 | ~4.5 |
| S3 clone answers | 17–30 | Sara is away, so her Clone answers for her, the way she would. | 13 | ~4.8 |
| S4 tab-tab | 30–40 | Clone predicts my next prompt. Tab, Tab, and it's sent. | 10 | ~4.0 |
| S5 auto-approve | 40–54 | Every teammate's Clone predicts their vote. They all agree, so Clone Mode ships it. No meeting. | 16 | ~6.5 |
| S5b fun fact | 54–60 | Fun fact: on DataClaw's 1,257 samples, Clone-0 predicts people with 93.9% accuracy. GPT-6 Astra gets 88.5%. | 17 (spoken ~28) | ~8.5 — see note |
| S6 dissent+learn | 60–78 | A risky call only pings the person who would object. Jun makes an exception, and his Clone learns. | 18 | ~7.0 |
| S7 logo | 78–86 | Clone Team Workspace. Multiplayer AI for your whole team. | 9 | ~3.5 |

Total runtime 86 s.

## Notes
- S5b: the numbers are kept exact, but read aloud ("one thousand two hundred fifty-seven",
  "ninety-three point nine percent") the line runs ~8–9 s, longer than the 6 s slot. Options:
  (a) lengthen S5b to 9–10 s (recommended; shift S6/S7 by +3–4 s), or
  (b) drop "on DataClaw's 1,257 samples" from the voice and show it on screen only (~5 s).
  Lead decides; the TTS text below is option (a).
- Split points: every scene is its own sentence(s) with a full stop, so cue cuts land in pauses.
- S4: say "Tab, Tab" on the double keypress; SFX key clicks go under both presses.
- S1 changed "the whole team" -> "your whole team" for a stronger hook. S3 adds "for her".
  Revert either if the lead prefers the storyboard wording.

## TTS text (single generation, paragraph breaks between scenes)

```
[confident] This is Clone's team workspace. One goal, one AI, and your whole team in the room.

Jun joins live. Everyone works in the same room, in real time.

Sara is away, so her Clone answers for her, the way she would.

Clone predicts my next prompt. Tab, Tab, and it's sent.

Every teammate's Clone predicts their vote. They all agree, so Clone Mode ships it. No meeting.

Fun fact: on DataClaw's 1,257 samples, Clone-0 predicts people with 93.9% accuracy. GPT-6 Astra gets 88.5%.

A risky call only pings the person who would object. Jun makes an exception, and his Clone learns.

Clone Team Workspace. Multiplayer AI for your whole team.
```
