// 12x12 pixel-style icons drawn with rects (crisp at any integer scale).
const P: Record<string, string[]> = {
  panel: ['xxxxxxxxxxxx', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'x......x...x', 'xxxxxxxxxxxx'],
  mini: ['............', '.......xxxxx', '.......x...x', '.......x...x', '.......xxxxx', '............', 'xxxxx.......', 'x...x.......', 'x...x.......', 'xxxxx.......', '............', '............'],
  full: ['xxxx....xxxx', 'x..........x', 'x..........x', 'x..........x', '............', '............', '............', '............', 'x..........x', 'x..........x', 'x..........x', 'xxxx....xxxx'],
  pin: ['....xxxx....', '....x..x....', '....x..x....', '...xx..xx...', '..xxxxxxxx..', '.....xx.....', '.....xx.....', '.....xx.....', '.....x......', '.....x......', '............', '............'],
  sound: ['.....x......', '....xx...x..', 'xxxxxx....x.', 'x...xx..x..x', 'x...xx...x.x', 'x...xx...x.x', 'x...xx..x..x', 'xxxxxx....x.', '....xx...x..', '.....x......', '............', '............'],
  gear: ['....xxxx....', '.x..x..x..x.', '..xxxxxxxx..', '..x......x..', 'xxx..xx..xxx', 'x...x..x...x', 'x...x..x...x', 'xxx..xx..xxx', '..x......x..', '..xxxxxxxx..', '.x..x..x..x.', '....xxxx....'],
  close: ['............', '.xx......xx.', '..xx....xx..', '...xx..xx...', '....xxxx....', '.....xx.....', '....xxxx....', '...xx..xx...', '..xx....xx..', '.xx......xx.', '............', '............'],
  expand: ['xxxxxx......', 'x.....x.....', 'x......x....', 'x.......x...', 'x........x..', 'x.........x.', '.x.........x', '..x........x', '...x.......x', '....x......x', '.....x.....x', '......xxxxxx'],
};

export function Icon({ name, size = 12 }: { name: keyof typeof P; size?: number }) {
  const rows = P[name];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === 'x' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}
export type IconName = keyof typeof P;
