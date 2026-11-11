// Demo team. Each teammate has a Clone: a compact model of how they think,
// plus corrections it learns whenever the human overrides it.
export function seedRoom() {
  const t = Date.now();
  return {
    name: 'Launch Room',
    goal: 'Launch Clone Team Workspace at c0mpiled Taipei tonight and sign 3 design-partner teams this week',
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
        learned: [],
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
        learned: [],
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
          'Would rather demo something real tonight than polish it for another week.',
          'Defers to Min and Jun on engineering and shipping calls; almost never blocks a ship decision.',
        ],
        learned: [],
      },
    ],
    plan: [
      { id: 'p1', text: 'Realtime room with humans + Clones', at: t },
      { id: 'p2', text: 'Team Clone Mode: Clones pre-approve, humans can Revert', at: t },
    ],
    proposals: [],
    messages: [
      {
        id: 'm0',
        at: t,
        kind: 'ai',
        author: 'ai',
        text: 'Room ready. Everyone here works with the same Team AI, and each teammate’s Clone speaks for them when they’re away.',
      },
    ],
  };
}
