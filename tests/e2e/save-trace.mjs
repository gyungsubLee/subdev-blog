// Diagnostic-only timing. No credentials or request/response bodies are recorded.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
const contexts = new AsyncLocalStorage();

export function stage(name) {
  const context = contexts.getStore();
  if (!context || context.name === name) return;
  const now = performance.now();
  context.stages.push({ name: context.name, startMs: context.stageAt - context.started, endMs: now - context.started });
  context.name = name;
  context.stageAt = now;
}

export async function traceRequest(operation) {
  const started = performance.now();
  const context = { started, stageAt: started, name: 'authentication', stages: [], calls: [] };
  return contexts.run(context, async () => {
    try {
      const result = await operation();
      stage('response');
      return { result, trace: context };
    } finally {
      const now = performance.now();
      context.totalMs = now - started;
      context.stages.push({ name: context.name, startMs: context.stageAt - started, endMs: now - started });
      delete context.started;
      delete context.stageAt;
      delete context.name;
    }
  });
}

export async function profileFetch(url, options, fetcher) {
  const context = contexts.getStore();
  if (!context) return fetcher(url, options);
  const origin = context.started;
  const started = performance.now();
  const call = { stage: context.name, method: options?.method ?? 'GET', host: new URL(url).host, path: new URL(url).pathname,
    requestBytes: typeof options?.body === 'string' ? Buffer.byteLength(options.body) : 0,
    startMs: started - origin, responseBytes: 0, bodyComplete: false };
  context.calls.push(call);
  try {
    const response = await fetcher(url, options);
    call.status = response.status;
    call.headersMs = performance.now() - started;
    call.endMs = performance.now() - origin;
    call.contentLengthHeader = response.headers.get('content-length');
    if (!response.body) { call.bodyComplete = true; return response; }
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          call.endMs = performance.now() - origin;
          if (done) { call.bodyComplete = true; controller.close(); reader.releaseLock(); }
          else { call.responseBytes += value.byteLength; controller.enqueue(value); }
        } catch (error) {
          call.endMs = performance.now() - origin;
          call.bodyError = error.name;
          controller.error(error);
        }
      },
      async cancel(reason) {
        call.endMs = performance.now() - origin;
        call.cancelled = true;
        await reader.cancel(reason);
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    call.endMs = performance.now() - origin;
    call.error = error.name;
    throw error;
  }
}
