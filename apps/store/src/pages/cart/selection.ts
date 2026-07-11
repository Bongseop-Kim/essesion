export function reconcileCartSelection(
  current: string[],
  itemIds: string[],
  initialized: boolean,
) {
  const next =
    itemIds.length === 0
      ? []
      : initialized
        ? current.filter((id) => itemIds.includes(id))
        : itemIds;

  return sameStringArray(current, next) ? current : next;
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
