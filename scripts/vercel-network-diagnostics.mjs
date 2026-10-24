import { subscribe } from 'node:diagnostics_channel';

let reports = 0;

function report(details) {
  if (reports >= 5) return;
  reports++;
  process.stderr.write(JSON.stringify(details) + '\n');
}

function reportError(event, error) {
  const candidates = [
    error,
    error?.cause,
    ...(Array.isArray(error?.errors) ? error.errors.slice(0, 5) : []),
    ...(Array.isArray(error?.cause?.errors) ? error.cause.errors.slice(0, 5) : []),
  ];
  const codes = candidates.map(candidate => candidate?.code)
    .filter(code => typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code))
    .slice(0, 5);
  report({ event, codes });
}

// The CLI discards fetch error causes. Keep only bounded, nonsecret diagnostics.
for (const event of ['undici:request:error', 'undici:client:connectError']) {
  subscribe(event, ({ error }) => reportError(event, error));
}

subscribe('undici:request:headers', ({ response }) => {
  const status = response?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    report({ event: 'undici:request:headers', status });
  }
});
