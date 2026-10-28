/** Retry only provider log-range limits, advancing to the range actually verified. */
export async function readRpcHistoryPage<T>(input: {
  afterBlock: number;
  targetBlock: number;
  maxSpan: number;
  knownSpan?: number;
  read(from: number, to: number): Promise<T>;
}) {
  const { afterBlock, targetBlock, maxSpan } = input;
  if (
    ![afterBlock, targetBlock, maxSpan].every(Number.isSafeInteger) ||
    afterBlock < -1 ||
    targetBlock <= afterBlock ||
    maxSpan < 1
  )
    throw new Error('无效的历史扫描区间');
  let span = Math.max(1, Math.min(maxSpan, input.knownSpan ?? maxSpan));
  while (true) {
    const toBlock = Math.min(targetBlock, afterBlock + span);
    try {
      return {
        value: await input.read(afterBlock + 1, toBlock),
        toBlock,
        span,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (
        /rate.?limit|429|too many requests/i.test(message) ||
        !/range|limited.*blocks|too many (?:logs|results)|response size|query returned more/i.test(
          message,
        ) ||
        span === 1
      )
        throw cause;
      const stated = message.match(
        /(?:0\s*(?:-|–|to)\s*|up to\s*|(?:maximum|limited to)\s*)(\d+)\s*blocks?/i,
      );
      const limit = stated ? Number(stated[1]) : 0;
      span =
        limit >= 1 && limit < span ? limit : Math.max(1, Math.floor(span / 2));
    }
  }
}
