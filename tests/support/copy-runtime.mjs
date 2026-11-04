import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Fixtures need executable modules, not public assets or generated server data.
export async function copyRuntime(destination) {
  for (const directory of [
    'app/shared', 'app/content', 'app/server/src', 'app/server/scripts',
    'app/web/src', 'app/web/scripts', 'scripts',
  ]) {
    const target = path.join(destination, directory);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(directory), target, { recursive: true });
  }
}
