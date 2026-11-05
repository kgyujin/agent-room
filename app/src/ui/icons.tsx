// Pixel icons drawn with rects (crisp at any integer scale): 'x' = ink, 'o' = soft fill.
// Toolbar icons are 16x16; close/expand and the status icons (bell ... note) are 12x12.
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
  bell: ['.....xx.....', '....xoox....', '...xoooox...', '...xoooox...', '..xoooooox..', '..xoooooox..', '..xoooooox..', '.xoooooooox.', '.xxxxxxxxxx.', '.....xx.....', '............', '............'],
  check: ['............', '..........x.', '.........xx.', '........xx..', '.x.....xx...', '.xx...xx....', '..xx.xx.....', '...xxxx.....', '....xx......', '............', '............', '............'],
  cog: ['.....xx.....', '..x.xxxx.x..', '...xxxxxx...', '..xxx..xxx..', '.xxx....xxx.', 'xxxx....xxxx', 'xxxx....xxxx', '.xxx....xxx.', '..xxx..xxx..', '...xxxxxx...', '..x.xxxx.x..', '.....xx.....'],
  pencil: ['..........xx', '.........xox', '........xox.', '.......xox..', '......xox...', '.....xox....', '....xox.....', '...xox......', '..xox.......', '.xxx........', '.xx.........', '............'],
  book: ['............', '.xxx....xxx.', 'xooox..xooox', 'xoooxxxxooox', 'xoooo.xoooox', 'xoooo.xoooox', 'xoooo.xoooox', 'xoooo.xoooox', 'xxxxx.xxxxxx', '....xxxx....', '............', '............'],
  play: ['............', '..x.........', '..xx........', '..xox.......', '..xoox......', '..xooox.....', '..xooox.....', '..xoox......', '..xox.......', '..xx........', '..x.........', '............'],
  flask: ['....xxxx....', '.....xx.....', '.....xx.....', '.....xx.....', '....xoox....', '...xoooox...', '..xoooooox..', '.xoooooooox.', '.xoooooooox.', '.xxxxxxxxxx.', '............', '............'],
  cross: ['............', '.xx......xx.', '..xx....xx..', '...xx..xx...', '....xxxx....', '.....xx.....', '....xxxx....', '...xx..xx...', '..xx....xx..', '.xx......xx.', '............', '............'],
  moon: ['.....xxx....', '...xxo......', '..xxo.......', '.xxo........', '.xxo........', '.xxo........', '.xxo........', '.xxoo.......', '..xxoo...x..', '...xxxxxxx..', '.....xxx....', '............'],
  clock: ['............', '...xxxxxx...', '..x......x..', '.x...x....x.', '.x...x....x.', '.x...xxx..x.', '.x........x.', '.x........x.', '..x......x..', '...xxxxxx...', '............', '............'],
  bolt: ['......xx....', '.....xx.....', '....xx......', '...xx.......', '..xxxxxx....', '......xx....', '.....xx.....', '....xx......', '...xx.......', '..x.........', '............', '............'],
  note: ['............', '.xxxxxxxxx..', '.x.......x..', '.x.xxxxx.x..', '.x.......x..', '.x.xxxx..x..', '.x.......x..', '.x.xxx...x..', '.x.......x..', '.xxxxxxxxx..', '............', '............'],
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

// Agent marks: pixel versions of the Claude and Codex icons (one colour per pixel).
// '.' clear, 'c' cream, 'e' cream edge, 'o' Claude orange, 'b'/'B' Codex blue (light/dark band),
// 'w' white, 'k' ink, 'p'/'P' demo purple.
const PAL: Record<string, string> = { c: '#f6efe4', e: '#e2d3c1', o: '#d97757', b: '#7184ff', B: '#5468ea', w: '#ffffff', k: '#1d1d24', p: '#a993d6', P: '#8c74c4' };
const MARK: Record<'claude' | 'codex' | 'demo', string[]> = {
  // Claude: orange starburst on cream
  claude: [
    '.eeeeeeeeeee.',
    'ecccccoccccce',
    'ecocccocccoce',
    'eccoccoccocce',
    'ecccocococcce',
    'eccccooocccce',
    'eoooooooooooe',
    'eccccooocccce',
    'ecccocococcce',
    'eccoccoccocce',
    'ecocccocccoce',
    'ecccccoccccce',
    '.eeeeeeeeeee.',
  ],
  // Codex: white cloud with a >_ prompt on a blue tile
  codex: [
    '.bbbbbbbbbbb.',
    'bbbbbbbbbbbbb',
    'bbbbbwwwbbbbb',
    'bbbwwwwwwwbbb',
    'bbwwwwwwwwwbb',
    'BwwkwwwwwwwwB',
    'BwwwkwwwwwwwB',
    'BwwkwwkkkwwwB',
    'BwwwwwwwwwwwB',
    'BBwwwwwwwwwBB',
    'BBBwwwBwwwBBB',
    'BBBBBBBBBBBBB',
    '.BBBBBBBBBBB.',
  ],
  // demo: play triangle
  demo: ['.ppppppppppp.', 'ppppppppppppp', 'ppppppppppppp', 'ppppwpppppppp', 'ppppwwppppppp', 'PPPPwwwPPPPPP', 'PPPPwwwwPPPPP', 'PPPPwwwPPPPPP', 'PPPPwwPPPPPPP', 'PPPPwPPPPPPPP', 'PPPPPPPPPPPPP', 'PPPPPPPPPPPPP', '.PPPPPPPPPPP.'],
};
const MARK_TITLE = { claude: 'Claude Code', codex: 'Codex', demo: '데모' };

/** small square badge that tells the agents apart without words */
export function AgentMark({ agent, size = 14 }: { agent: 'claude' | 'codex' | 'demo'; size?: number }) {
  const rows = MARK[agent];
  return (
    <svg className="agent-mark" width={size} height={size} viewBox="0 0 13 13" shapeRendering="crispEdges" role="img" aria-label={MARK_TITLE[agent]}>
      <title>{MARK_TITLE[agent]}</title>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PAL[c]} />)))}
    </svg>
  );
}
