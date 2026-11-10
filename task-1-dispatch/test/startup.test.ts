import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

for (const [name, file, endpoint] of [
  ['dispatch', 'task-1-dispatch/src/server.ts', '/branches'],
  ['booking', 'task-2-booking/src/server.ts', '/masters'],
]) {
  test(`${name}: CLI serves requests and handles a conflicting port`, { timeout: 15000 }, async (t) => {
    const env = { ...process.env };
    delete env.PORT;
    const child = spawn(process.execPath, [file], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
    });
    let stdout = '';
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start')), 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const match = /http:\/\/localhost:(\d+)/.exec(stdout);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    const response = await fetch(url + endpoint);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(await response.json()));
    await assert.rejects(exec(process.execPath, [file], {
      cwd: root, env, timeout: 5000,
    }), (error: unknown) => {
      const failure = error as { code: number; stderr: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr, /already in use/);
      assert.doesNotMatch(failure.stderr, /Unhandled|node:events/);
      return true;
    });
    assert.equal((await fetch(url + endpoint)).status, 200);
  });

}
