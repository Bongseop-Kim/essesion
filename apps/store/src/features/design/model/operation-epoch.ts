export function createOperationEpoch() {
  let current = 0;

  return {
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(epoch: number) {
      return epoch === current;
    },
  };
}
