// Direct-CLI detection shared by the standalone tools in this directory.
//
// The check has to survive a symlinked entry point. A lexical comparison makes
// `node <symlink-to-this-file>` skip the CLI entirely: it exits 0 without doing any
// work, which is indistinguishable from a successful run. Both sides are therefore
// canonicalized, so every invocation path actually runs the CLI.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isDirectCliInvocation(moduleUrl, invokedPath = process.argv[1]) {
    if (!invokedPath) {
        return false;
    }

    const modulePath = fileURLToPath(moduleUrl);
    if (path.resolve(invokedPath) === modulePath) {
        return true;
    }

    try {
        return realpathSync(invokedPath) === realpathSync(modulePath);
    } catch {
        // A path that cannot be canonicalized is not this module's own entry point: a
        // real direct invocation always resolves. Declining here only skips the CLI; it
        // never turns a failure into a reported success.
        return false;
    }
}
