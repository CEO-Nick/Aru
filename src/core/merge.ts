/**
 * 같은 파일을 두 곳(작은 창·모아보기 창·다른 편집기·aru 명령)에서 동시에 고쳤을 때 줄 단위로 합친다.
 * base: 마지막으로 함께 본 내용, mine: 아직 저장 전인 내 내용, theirs: 그 사이 파일에 써진 내용.
 * 저쪽이 지운 줄은 내 쪽에서도 지우고, 저쪽이 새로 넣은 줄은 저쪽에서의 앞 줄 뒤(내가 넣은 줄 다음)에 끼운다.
 * 줄은 글자가 아니라 base의 몇 번째 줄이었는지로 맞춘다. 같은 글자의 줄이 여럿이어도 엉뚱한 줄을 지우거나 고치지 않는다
 */
export function mergeContent(base: string, mine: string, theirs: string): string {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;

  const b = toLines(base);
  const m = toLines(mine);
  const t = toLines(theirs);
  const bm = align(b, m);
  const bt = align(b, t);

  /**
   * origin: 이 줄이 base의 몇 번째 줄이었는지(내가 넣었거나 고친 줄이면 -1). theirs: 저쪽이 넣어 끼운 줄.
   * inserted: 내가 새로 넣은 줄(고친 줄은 아니다). 저쪽 줄을 끼울 자리를 정할 때 이 줄만 건너뛴다
   */
  type Entry = { line: string; origin: number; theirs?: true; inserted?: true };
  const result: Entry[] = m.map((line) => ({ line, origin: -1 }));
  const byOrigin = new Map<number, Entry>();
  bm.forEach((j, i) => {
    if (j === -1) return;
    result[j].origin = i;
    byOrigin.set(i, result[j]);
  });
  const mineEdits = edits(b, m, bm);
  const editedByMe = new Set(mineEdits.values());
  result.forEach((e, j) => e.origin === -1 && !editedByMe.has(j) && (e.inserted = true));
  /** 저쪽 줄 → 결과에서 그 줄에 해당하는 항목(내가 고친 줄이면 고친 줄). 저쪽이 넣은 줄의 자리를 정할 때 쓴다 */
  const forTheirs = new Map<number, Entry>();
  bt.forEach((j, i) => {
    const edited = mineEdits.get(i);
    const entry = byOrigin.get(i) ?? (edited === undefined ? undefined : result[edited]);
    if (j !== -1 && entry) forTheirs.set(j, entry);
  });

  // 같은 줄을 한쪽은 체크만 바꾸고 다른 쪽은 글자를 고쳤으면, 지우고 넣기로 다루면 둘로 갈라진다.
  // 고친 글자에 바뀐 체크 상태를 입혀 한 줄로 만든다. 체크해서 아래로 옮겨진 줄도 짝을 찾는다
  const settled = new Set<number>();
  for (const [i, tj] of edits(b, t, bt)) {
    const mj = mineEdits.get(i);
    if (mj === undefined) continue;
    const from = b[i];
    const to = t[tj];
    const mineTo = m[mj];
    let combined: string | null = mineTo === to ? mineTo : null;
    if (combined === null && isToggle(from, to)) combined = withCheck(mineTo, to);
    else if (combined === null && isToggle(from, mineTo)) combined = withCheck(to, mineTo);
    if (combined === null) continue;
    result[mj].line = combined;
    settled.add(i);
    forTheirs.set(tj, result[mj]);
  }

  // 저쪽이 지웠거나 고친(=지우고 넣은) base 줄은 내 쪽에서도 지운다. 내가 이미 지웠거나 고쳤으면 그대로 둔다
  const removed = new Set<Entry>();
  bt.forEach((j, i) => {
    const entry = byOrigin.get(i);
    if (j === -1 && !settled.has(i) && entry) removed.add(entry);
  });
  const merged = result.filter((e) => !removed.has(e));

  // 저쪽이 넣은 줄이 내가 넣거나 고친 줄과 글자가 같으면 내가 이미 반영한 변경이 되돌아온 것이다. 넣지 않고
  // 그 줄을 저쪽 줄의 자리로 삼는다(뒤따르는 저쪽 줄이 그 아래에 붙게). 손대지 않은 줄과 같은 글자면 저쪽이 일부러 넣은 줄이다
  const fromTheirs = new Set(bt);
  const echoes = new Map<string, Entry[]>();
  for (const e of merged) if (e.origin === -1) (echoes.get(e.line) ?? echoes.set(e.line, []).get(e.line)!).push(e);

  t.forEach((line, j) => {
    if (fromTheirs.has(j) || forTheirs.has(j)) return;
    const echo = echoes.get(line)?.shift();
    if (echo) {
      forTheirs.set(j, echo);
      return;
    }
    let at = 0;
    for (let k = j - 1; k >= 0; k--) {
      const anchor = forTheirs.get(k);
      const found = anchor ? merged.indexOf(anchor) : -1;
      if (found === -1) continue;
      at = found + 1;
      // 같은 자리에 내가 먼저 넣은 줄이 있으면 그 뒤에 둔다
      while (at < merged.length && merged[at].inserted) at++;
      break;
    }
    const entry: Entry = { line, origin: -1, theirs: true };
    merged.splice(at, 0, entry);
    forTheirs.set(j, entry);
  });

  return merged.length ? `${merged.map((e) => e.line).join("\n")}\n` : "";
}

function toLines(content: string): string[] {
  return content.split("\n").filter((line, i, all) => !(i === all.length - 1 && line === ""));
}

const TASK = /^(\s*[-*+] \[)([ xX])(\].*)$/s;

/** 체크 칸만 다르고 나머지가 같은 할 일 줄인가 */
function isToggle(a: string, b: string): boolean {
  const x = TASK.exec(a);
  const y = TASK.exec(b);
  return !!x && !!y && x[1] === y[1] && x[3] === y[3] && (x[2] === " ") !== (y[2] === " ");
}

/** line의 체크 상태를 from의 것으로 바꾼다. 할 일 줄이 아니면 null */
function withCheck(line: string, from: string): string | null {
  const x = TASK.exec(line);
  const y = TASK.exec(from);
  return x && y ? `${x[1]}${y[2]}${x[3]}` : null;
}

/** 이보다 큰 표는 만들지 않는다. 5천 줄 전체가 재배치되면 표 하나가 100MB를 넘는다 */
const LCS_CELL_LIMIT = 1_000_000;

/**
 * base의 각 줄이 side의 몇 번째 줄과 같은 줄인지(없으면 -1).
 * 가장 긴 공통 부분열로 맞추고, 남은 줄 중 글자가 같은 것은 옮겨진 줄로 본다(같은 글자가 여럿이면 원래 자리에 가까운 것).
 * 바뀐 구간이 너무 크면 부분열 대신 글자가 같은 줄을 나온 순서대로 맞춘다
 */
function align(base: string[], side: string[]): Int32Array {
  const map = new Int32Array(base.length).fill(-1);
  let start = 0;
  while (start < base.length && start < side.length && base[start] === side[start]) {
    map[start] = start;
    start++;
  }
  let endB = base.length;
  let endS = side.length;
  while (endB > start && endS > start && base[endB - 1] === side[endS - 1]) {
    endB--;
    endS--;
    map[endB] = endS;
  }
  const n = endB - start;
  const k = endS - start;
  if (n && k && n * k <= LCS_CELL_LIMIT) {
    const w = k + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = k - 1; j >= 0; j--) {
        lcs[i * w + j] =
          base[start + i] === side[start + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < k) {
      if (base[start + i] === side[start + j]) {
        map[start + i] = start + j;
        i++;
        j++;
      } else if (lcs[i * w + j + 1] >= lcs[(i + 1) * w + j]) j++;
      else i++;
    }
  }
  // 남은 줄 중 글자가 같은 것은 자리만 옮긴 줄이다(체크해서 정렬됨 등)
  const used = new Uint8Array(side.length);
  map.forEach((j) => j !== -1 && (used[j] = 1));
  const free = new Map<string, number[]>();
  for (let j = start; j < endS; j++) if (!used[j]) (free.get(side[j]) ?? free.set(side[j], []).get(side[j])!).push(j);
  for (let i = start; i < endB; i++) {
    if (map[i] !== -1) continue;
    const list = free.get(base[i]);
    if (!list?.length) continue;
    map[i] = list.splice(nearest(list, i), 1)[0];
  }
  return map;
}

/** list에서 at에 가장 가까운 값의 자리. 같은 줄이 아주 많으면(빈 줄 등) 앞에서부터 쓴다 */
function nearest(list: number[], at: number): number {
  if (list.length > 64) return 0;
  let best = 0;
  for (let x = 1; x < list.length; x++) if (Math.abs(list[x] - at) < Math.abs(list[best] - at)) best = x;
  return best;
}

/**
 * base에서 side로 바뀐 줄 중 한 줄이 다른 한 줄로 바뀐 것을 짝지어 돌려준다(base 줄 번호 → side 줄 번호).
 * - 제자리: 맞춘 줄 사이에 낀 구간이 양쪽 다 한 줄이면 고친 것으로 본다
 * - 옮겨진 체크: 체크 칸만 다른 줄이 다른 자리에 있으면 체크해서 옮긴 것으로 본다
 */
function edits(base: string[], side: string[], map: Int32Array): Map<number, number> {
  const pairs = new Map<number, number>();
  const used = new Uint8Array(side.length);
  map.forEach((j) => j !== -1 && (used[j] = 1));
  // 맞춘 줄이 순서대로일 때만 구간이 뜻이 있다(부분열을 건너뛴 큰 파일은 순서가 섞여 있을 수 있다)
  let prevB = -1;
  let prevS = -1;
  const close = (endB: number, endS: number) => {
    if (endB - prevB === 2 && endS - prevS === 2 && !used[prevS + 1] && map[prevB + 1] === -1) pairs.set(prevB + 1, prevS + 1);
  };
  let ordered = true;
  for (let i = 0; i < base.length && ordered; i++) {
    const j = map[i];
    if (j === -1) continue;
    if (j < prevS) ordered = false;
    else {
      close(i, j);
      prevB = i;
      prevS = j;
    }
  }
  if (ordered) close(base.length, side.length);
  for (const j of pairs.values()) used[j] = 1;

  const toggles = new Map<string, number[]>();
  side.forEach((line, j) => {
    const key = toggleKey(line);
    if (!used[j] && key !== null) (toggles.get(key) ?? toggles.set(key, []).get(key)!).push(j);
  });
  base.forEach((line, i) => {
    if (map[i] !== -1 || pairs.has(i)) return;
    const key = toggleKey(line);
    const list = key === null ? undefined : toggles.get(key)?.filter((j) => isToggle(line, side[j]));
    if (!list?.length) return;
    const j = list[nearest(list, i)];
    toggles.get(key!)!.splice(toggles.get(key!)!.indexOf(j), 1);
    pairs.set(i, j);
  });
  return pairs;
}

/** 체크 칸을 뺀 할 일 줄. 할 일 줄이 아니면 null */
function toggleKey(line: string): string | null {
  const x = TASK.exec(line);
  return x ? `${x[1]}\u0000${x[3]}` : null;
}
