/**
 * 같은 파일을 두 곳(작은 창·모아보기 창·다른 편집기)에서 동시에 고쳤을 때 줄 단위로 합친다.
 * base: 마지막으로 함께 본 내용, mine: 아직 저장 전인 내 내용, theirs: 그 사이 파일에 써진 내용.
 * 저쪽이 지운 줄은 내 쪽에서도 지우고, 저쪽이 새로 넣은 줄은 저쪽에서의 앞 줄 뒤(내가 넣은 줄 다음)에 끼운다.
 */
export function mergeContent(base: string, mine: string, theirs: string): string {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;

  const baseLines = toLines(base);
  const theirLines = toLines(theirs);
  const result = toLines(mine);
  const mineAdded = new Set(without(result, baseLines));

  for (const line of without(baseLines, theirLines)) {
    const i = result.indexOf(line);
    if (i !== -1) result.splice(i, 1);
  }

  const added = new Set(without(theirLines, baseLines));
  theirLines.forEach((line, i) => {
    if (!added.has(line)) return;
    added.delete(line);
    const before = theirLines[i - 1];
    let at = 0;
    if (before !== undefined) {
      const found = result.lastIndexOf(before);
      at = found === -1 ? result.length : found + 1;
      // 같은 자리에 내가 먼저 넣은 줄이 있으면 그 뒤에 둔다
      while (at < result.length && mineAdded.has(result[at])) at++;
    }
    result.splice(at, 0, line);
  });

  return result.length ? `${result.join("\n")}\n` : "";
}

function toLines(content: string): string[] {
  return content.split("\n").filter((line, i, all) => !(i === all.length - 1 && line === ""));
}

/** a에서 b에 없는 줄 (같은 줄이 여러 번이면 개수만큼 센다) */
function without(a: string[], b: string[]): string[] {
  const rest = [...b];
  return a.filter((line) => {
    const i = rest.indexOf(line);
    if (i === -1) return true;
    rest.splice(i, 1);
    return false;
  });
}
