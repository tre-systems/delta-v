import { spawn } from 'node:child_process';

export const parseJsonFromOutput = <T>(raw: string): T => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('output was empty');

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lines = trimmed.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines[index].trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Keep scanning for the last valid JSON line.
      }
    }
  }

  throw new Error('output did not contain valid JSON');
};

export const runJsonCommand = async <T>(
  command: string,
  payload: unknown,
  timeoutMs: number,
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const child = spawn('zsh', ['-lc', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill('SIGKILL');
        reject(new Error(`command timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      settle(() => reject(error));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      settle(() => {
        if (code !== 0) {
          reject(
            new Error(
              `command exited with code ${code}. stderr: ${stderr.trim() || '(none)'}`,
            ),
          );
          return;
        }

        try {
          resolve(parseJsonFromOutput<T>(stdout));
        } catch (error) {
          reject(
            new Error(
              `failed to parse command JSON: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
