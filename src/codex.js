import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Codex desktop names the CLI it runs and appends it to PATH, after any
// standalone install. An older `codex` found first does not speak the same
// protocol, so prefer the one the app ships with.
export function codexCommand(env = process.env) {
  const bundled = env.CODEX_APP_RUNTIME_CLI_PATH;
  if (bundled && path.isAbsolute(bundled)) {
    try {
      fs.accessSync(bundled, fs.constants.X_OK);
      return bundled;
    } catch {
      // Fall back to PATH when the app moved or was removed.
    }
  }
  return 'codex';
}

const probes = new Map();
// `codex queue --help` lists exactly the options this CLI accepts. Older
// releases queue messages but have no `--resume`. Null means the probe failed
// and the queue call itself reports the problem.
export function queueOptions(command) {
  if (!probes.has(command))
    probes.set(
      command,
      exec(command, ['queue', '--help'], { timeout: 10000, killSignal: 'SIGKILL' }).then(
        ({ stdout, stderr }) => ({ resume: /^\s*--resume\b/m.test(stdout + '\n' + stderr) }),
        () => null,
      ),
    );
  return probes.get(command);
}
