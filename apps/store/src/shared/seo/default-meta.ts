/**
 * index.html(또는 Worker)이 넣은 기본 메타(`data-seo-default`)를 앱 시작 때 걷어낸다 —
 * 페이지가 덧붙인 메타와 두 벌이 되면 검색엔진이 어느 쪽을 쓸지 정해져 있지 않다.
 * 기본 title만은 남겨 두었다가, 페이지가 title을 렌더하지 않는 화면(장바구니·마이페이지 등)에서 쓴다.
 */
export function initDefaultMeta() {
  const head = document.head;
  const fallback = head.querySelector("title[data-seo-default]");
  for (const el of head.querySelectorAll("[data-seo-default]")) {
    if (el !== fallback) el.remove();
  }
  if (!fallback) return;
  const sync = () => {
    const pageHasTitle = [...head.querySelectorAll("title")].some(
      (title) => title !== fallback,
    );
    if (pageHasTitle) fallback.remove();
    else if (!fallback.isConnected) head.append(fallback);
  };
  new MutationObserver(sync).observe(head, { childList: true });
  sync();
}
