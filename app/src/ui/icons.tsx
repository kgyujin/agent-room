// Pixel icons drawn with rects (crisp at any integer scale): 'x' = ink, 'o' = soft fill.
// Toolbar icons are 16x16; close/expand stay 12x12.
const P: Record<string, string[]> = {
  panel: ['................', '.xxxxxxxxxxxxxx.', '.x........xooox.', '.x........xooox.', '.x........x...x.', '.x........xooox.', '.x........x...x.', '.x........xooox.', '.x........x...x.', '.x........x...x.', '.x........x...x.', '.x........x...x.', '.x........x...x.', '.xxxxxxxxxxxxxx.', '................', '................'],
  eye: ['................', '................', '................', '.....xxxxxx.....', '...xx......xx...', '..x...xxxx...x..', '.x...xxoxxx...x.', 'x....xooxxx....x', '.x...xxxxxx...x.', '..x...xxxx...x..', '...xx......xx...', '.....xxxxxx.....', '................', '................', '................', '................'],
  mini: ['................', '.xxxxxxxxxxxxx..', '.x...........x..', '.x...........x..', '.x...........x..', '.x.....xxxxxxxxx', '.x.....xoooooooo', '.x.....xoooooooo', '.x.....xoooooooo', '.xxxxxxxoooooooo', '.......xoooooooo', '.......xxxxxxxxx', '................', '................', '................', '................'],
  pin: ['................', '.....xxxxxx.....', '.....xooooox....', '......xooox.....', '......xooox.....', '.....xooooox....', '....xooooooox...', '...xxxxxxxxxxx..', '.......xx.......', '.......xx.......', '.......xx.......', '.......xx.......', '........x.......', '................', '................', '................'],
  full: ['................', '.xxxxx....xxxxx.', '.xoo........oox.', '.xo..........ox.', '.x............x.', '.x............x.', '................', '................', '................', '................', '.x............x.', '.x............x.', '.xo..........ox.', '.xoo........oox.', '.xxxxx....xxxxx.', '................'],
  sound: ['................', '................', '.......x........', '......xx....x...', '.....xox.....x..', '.xxxxxox..x...x.', '.xooooox...x..x.', '.xooooox...x..x.', '.xooooox...x..x.', '.xooooox...x..x.', '.xxxxxox..x...x.', '.....xox.....x..', '......xx....x...', '.......x........', '................', '................'],
  mute: ['................', '................', '.......x........', '......xx........', '.....xox........', '.xxxxxox..x...x.', '.xooooox...x.x..', '.xooooox....x...', '.xooooox...x.x..', '.xooooox..x...x.', '.xxxxxox........', '.....xox........', '......xx........', '.......x........', '................', '................'],
  gear: ['................', '......xxxx......', '..xx..xoox..xx..', '..xoxxxooxxxox..', '...xoooooooox...', '.xxxoooxxooooxxx', '.xoooox..xoooox.', '.xooox....xooox.', '.xooox....xooox.', '.xoooox..xoooox.', '.xxxooooxxoooxxx', '...xoooooooox...', '..xoxxxooxxxox..', '..xx..xoox..xx..', '......xxxx......', '................'],
  close: ['............', '.xx......xx.', '..xx....xx..', '...xx..xx...', '....xxxx....', '.....xx.....', '....xxxx....', '...xx..xx...', '..xx....xx..', '.xx......xx.', '............', '............'],
  expand: ['xxxxxx......', 'x.....x.....', 'x......x....', 'x.......x...', 'x........x..', 'x.........x.', '.x.........x', '..x........x', '...x.......x', '....x......x', '.....x.....x', '......xxxxxx'],
};

export function Icon({ name, size = 12 }: { name: keyof typeof P; size?: number }) {
  const rows = P[name];
  const n = rows.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" opacity={c === 'o' ? 0.35 : 1} />)))}
    </svg>
  );
}
export type IconName = keyof typeof P;

// Agent marks (original pixel badges, not vendor logos): 'b' = badge colour, 'w' = white glyph.
const MARK: Record<'claude' | 'codex' | 'demo', string[]> = {
  // a four-point sparkle
  claude: ['.bbbbbbbbbbb.', 'bbbbbbwbbbbbb', 'bbbbbbwbbbbbb', 'bbbbbwwwbbbbb', 'bbbbbwwwbbbbb', 'bbbwwwwwwwbbb', 'bwwwwwwwwwwwb', 'bbbwwwwwwwbbb', 'bbbbbwwwbbbbb', 'bbbbbwwwbbbbb', 'bbbbbbwbbbbbb', 'bbbbbbwbbbbbb', '.bbbbbbbbbbb.'],
  // a terminal prompt  >_
  codex: ['.bbbbbbbbbbb.', 'bbbbbbbbbbbbb', 'bbbbbbbbbbbbb', 'bbwwbbbbbbbbb', 'bbbwwbbbbbbbb', 'bbbbwwbbbbbbb', 'bbbbbwwbbbbbb', 'bbbbwwbbbbbbb', 'bbbwwbbbbbbbb', 'bbwwbbbwwwwwb', 'bbbbbbbwwwwwb', 'bbbbbbbbbbbbb', '.bbbbbbbbbbb.'],
  // a play triangle
  demo: ['.bbbbbbbbbbb.', 'bbbbbbbbbbbbb', 'bbbbbbbbbbbbb', 'bbbbwbbbbbbbb', 'bbbbwwbbbbbbb', 'bbbbwwwbbbbbb', 'bbbbwwwwbbbbb', 'bbbbwwwbbbbbb', 'bbbbwwbbbbbbb', 'bbbbwbbbbbbbb', 'bbbbbbbbbbbbb', 'bbbbbbbbbbbbb', '.bbbbbbbbbbb.'],
};
const MARK_TITLE = { claude: 'Claude Code', codex: 'Codex', demo: '데모' };

/** small square badge that tells the agents apart without words */
export function AgentMark({ agent, size = 14 }: { agent: 'claude' | 'codex' | 'demo'; size?: number }) {
  const rows = MARK[agent];
  return (
    <svg className="agent-mark" width={size} height={size} viewBox="0 0 13 13" shapeRendering="crispEdges" role="img" aria-label={MARK_TITLE[agent]}>
      <title>{MARK_TITLE[agent]}</title>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === 'w' ? '#fff' : `var(--${agent})`} />)))}
    </svg>
  );
}
