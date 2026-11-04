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
