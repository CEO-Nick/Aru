// 사용: osascript -l JavaScript scripts/window-id.js <프로세스 이름> [순위]
// 해당 프로세스의 화면 위 창을 크기순으로 세워 [순위]번째(0부터, 기본 0 = 가장 큰 창) 창 번호를 출력한다.
// 그 창만 캡처할 때 쓴다(screencapture -l). 항상 위 창은 레이어가 0이 아니고,
// 메뉴 막대 아이콘도 같은 프로세스의 작은 창으로 잡혀서 레이어 대신 크기로 고른다.
ObjC.import("CoreGraphics");
function run(argv) {
  const owner = argv[0];
  const rank = Number(argv[1] ?? 0);
  const list = ObjC.deepUnwrap(
    ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)),
  );
  const area = (w) => w.kCGWindowBounds.Width * w.kCGWindowBounds.Height;
  const wins = list
    .filter((w) => w.kCGWindowOwnerName === owner && w.kCGWindowBounds.Height > 100)
    .sort((a, b) => area(b) - area(a));
  return wins[rank] ? String(wins[rank].kCGWindowNumber) : "";
}
