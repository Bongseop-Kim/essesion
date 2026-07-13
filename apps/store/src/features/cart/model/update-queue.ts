export function createCartUpdateQueue() {
  let tail = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
