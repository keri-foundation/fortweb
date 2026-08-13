import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const runtimeDir = path.join(projectDir, 'app', 'runtime');

// The wallet-worker module imports Pyodide-only names (`js`, `pyscript`) at
// module top level. Stub those so the real module body executes under plain
// CPython. This exercises actual Python import + module-level name resolution,
// which is what regressed: `_ensure_registry()` reads `_REGISTRY` before any
// module-level assignment existed.
const PYTHON_PROBE = `
import asyncio
import importlib.util
import sys
import types

# wallet-worker.py schedules _preload() at module bottom via
# asyncio.ensure_future(), which needs a current event loop. Provide one; the
# scheduled coroutine is never run (no package loading) — we only need the
# module-level state bindings to have executed.
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

sys.modules['js'] = types.SimpleNamespace()
sys.modules['pyscript'] = types.SimpleNamespace(sync=types.SimpleNamespace(), config={})

# onboarding / transporting / vaulting are sibling modules in the runtime dir.
sys.path.insert(0, ${JSON.stringify(runtimeDir)})

# wallet-worker.py has a hyphen, so import it by file location.
spec = importlib.util.spec_from_file_location(
    "wallet_worker",
    ${JSON.stringify(path.join(runtimeDir, 'wallet-worker.py'))},
)
ww = importlib.util.module_from_spec(spec)
sys.modules["wallet_worker"] = ww
spec.loader.exec_module(ww)

missing = []
for name in ('_REGISTRY', '_STATE'):
    if not hasattr(ww, name):
        missing.append(name)
        continue
    if getattr(ww, name) is not None:
        raise SystemExit(f'{name} should initialize to None')

if missing:
    raise SystemExit('uninitialized wallet-worker runtime globals: ' + ', '.join(missing))

print('wallet-worker runtime globals initialized: _REGISTRY, _STATE')
`;

test('wallet-worker initializes registry and open-vault state globals', () => {
    const result = spawnSync('python3', ['-c', PYTHON_PROBE], {
        cwd: projectDir,
        encoding: 'utf8',
    });

    assert.strictEqual(
        result.status,
        0,
        `python probe failed (status ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
});
