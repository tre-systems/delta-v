/**
 * MCP stdio: the upstream SDK dispatches concurrent `tools/call` requests
 * without awaiting handlers, but each completion calls `transport.send()`.
 * Parallel `send()` calls can interleave partial `stdout.write()` chunks and
 * corrupt JSON-RPC framing. Queue sends so every outbound line is written
 * atomically in order.
 */
export const patchTransportWithSerializedSends = (transport: {
  // biome-ignore lint/suspicious/noExplicitAny: bridges StdioServerTransport and test doubles without pulling SDK types into every consumer.
  send: (message: any) => Promise<void>;
}): void => {
  let outboundTail: Promise<unknown> = Promise.resolve();
  const origSend = transport.send.bind(transport);
  transport.send = (message: unknown) => {
    const work = outboundTail.then(
      () => origSend(message),
      () => origSend(message),
    );
    outboundTail = work.then(
      () => undefined,
      () => undefined,
    );
    return work as Promise<void>;
  };
};
