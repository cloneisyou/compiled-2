// Demo team. Each teammate has a Clone: a compact model of how they think,
// used to write the next prompt the way that person would.
export function seedRoom() {
  const t = Date.now();
  return {
    name: 'Launch Room',
    goal: 'Launch Clone Team Workspace at c0mpiled Taipei tonight and sign 3 design-partner teams this week',
    driver: 'min',
    members: [
      {
        id: 'min',
        name: 'Min',
        role: 'CEO',
        color: '#2f6bff',
        memory: [
          'Optimizes for speed and live demos over polish.',
          'Wants every launch tied to a measurable customer outcome.',
          'Happy to spend on ads only after organic signal.',
        ],
      },
      {
        id: 'jun',
        name: 'Jun',
        role: 'Engineer',
        color: '#12a37f',
        memory: [
          'Hates scope creep the night before a launch.',
          'Will not ship anything without a working end-to-end test.',
          'Prefers boring infra: Postgres, one server, no new vendors.',
          'Strongly against storing customer data with new third parties.',
        ],
      },
      {
        id: 'sara',
        name: 'Sara',
        role: 'Design',
        color: '#e5484d',
        memory: [
          'Minimal copy, one sentence per screen.',
          'Always ships dark mode; dislikes purple gradients and stock illustrations.',
          'Pushes for onboarding that shows value in under 30 seconds.',
          'Loves inviting real users into early demos.',
        ],
      },
    ],
    plan: [
      { id: 'p1', text: 'One live session: presence, cursors, one shared thread', at: t },
      { id: 'p2', text: 'Pick whose Clone writes the next prompt', at: t },
    ],
    suggestions: {},
    messages: [{ id: 'm0', at: t, kind: 'ai', author: 'ai', text: 'Room ready. One session for the whole team: see the work, steer it, or take it over.' }],
  };
}
