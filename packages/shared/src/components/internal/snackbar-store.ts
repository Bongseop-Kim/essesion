/* Snackbar 큐의 순수 상태 스토어 — DOM·React 무관.
   한 번에 하나만 노출(current), 나머지는 순서대로 queue에 대기.
   snackbar.tsx의 SnackbarHost가 useSyncExternalStore로 구독한다(breakpoint.ts 패턴). */

export type SnackbarAction = { label: string; onClick: () => void };

export type SnackbarItem = {
  id: number;
  message: string;
  action?: SnackbarAction;
  duration: number;
};

export type SnackbarState = {
  current: SnackbarItem | null;
  queue: readonly SnackbarItem[];
  avoidBottom: number;
};

const DEFAULT_DURATION = 4000;

let state: SnackbarState = { current: null, queue: [], avoidBottom: 0 };
let nextId = 1;
let nextAvoidId = 1;
const avoidOverlaps = new Map<number, number>();
const listeners = new Set<() => void>();

function commit(next: SnackbarState) {
  state = next;
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 불변 스냅샷 — 변경이 있을 때만 새 객체를 만든다(useSyncExternalStore 안정성). */
export function getSnapshot(): SnackbarState {
  return state;
}

/** 큐에 넣는다. current가 비어 있으면 즉시 current로 승격. 부여한 id 반환. */
export function enqueue(
  message: string,
  options?: { action?: SnackbarAction; duration?: number },
): number {
  const id = nextId++;
  const item: SnackbarItem = {
    id,
    message,
    action: options?.action,
    duration: options?.duration ?? DEFAULT_DURATION,
  };
  if (state.current === null) {
    commit({ ...state, current: item });
  } else {
    commit({ ...state, queue: [...state.queue, item] });
  }
  return id;
}

/** id 생략 또는 current와 일치 → current 제거 후 큐 승격. 큐에 있으면 큐에서만 제거. */
export function dismiss(id?: number): void {
  if (state.current !== null && (id === undefined || id === state.current.id)) {
    advance();
    return;
  }
  if (id === undefined) return;
  const queue = state.queue.filter((item) => item.id !== id);
  if (queue.length !== state.queue.length) {
    commit({ ...state, queue });
  }
}

/** current = queue[0] ?? null (머리를 큐에서 꺼내 승격). */
export function advance(): void {
  if (state.current === null && state.queue.length === 0) return;
  const [next, ...rest] = state.queue;
  commit({ ...state, current: next ?? null, queue: rest });
}

function syncAvoidBottom() {
  const avoidBottom = Math.max(0, ...avoidOverlaps.values());
  if (avoidBottom !== state.avoidBottom) {
    commit({ ...state, avoidBottom });
  }
}

export function registerAvoidOverlap(): number {
  const id = nextAvoidId++;
  avoidOverlaps.set(id, 0);
  return id;
}

export function updateAvoidOverlap(id: number, height: number): void {
  avoidOverlaps.set(id, Math.max(0, Math.ceil(height)));
  syncAvoidBottom();
}

export function unregisterAvoidOverlap(id: number): void {
  if (avoidOverlaps.delete(id)) syncAvoidBottom();
}

/** 테스트 전용 — 상태와 id 카운터를 초기화. */
export function reset(): void {
  state = { current: null, queue: [], avoidBottom: 0 };
  nextId = 1;
  nextAvoidId = 1;
  avoidOverlaps.clear();
  for (const fn of listeners) fn();
}
