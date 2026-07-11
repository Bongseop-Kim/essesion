const dateGroupFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

export function groupByCreatedDate<T extends { created_at: string }>(
  items: readonly T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = dateGroupFormat.format(new Date(item.created_at));
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  return [...groups.entries()];
}
