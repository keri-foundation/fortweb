"""Shared static-serving behavior for the FortWeb development servers.

Both ``serve.py`` and ``scripts/serve_local.py`` serve the FortWeb browser
runtime from the ``libs`` workspace root using the ``/fortweb/...`` URL layout.
Keeping the MIME map and path resolution in one place prevents the two
development servers from drifting apart.
"""

from __future__ import annotations

import os

FORTWEB_EXTENSIONS_MAP = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".cjs": "application/javascript",
    ".whl": "application/octet-stream",
    ".wasm": "application/wasm",
    ".json": "application/json",
}


def resolve_fortweb_path(directory: str, path: str):
    """Resolve a ``/fortweb/...`` URL to a filesystem path, or ``None``.

    ``directory`` is the served document root (the parent of the ``fortweb``
    repo, usually ``libs/`` in the workspace). Returning ``None`` signals the
    caller to fall back to the default request-handler path translation.
    """
    if path.startswith('/fortweb/vendor/'):
        vendor_relative = path[len('/fortweb/vendor/'):]
        dist_vendor_path = os.path.join(directory, 'fortweb', 'dist', 'runtime', 'vendor', vendor_relative)
        if os.path.exists(dist_vendor_path):
            return dist_vendor_path
        return os.path.join(directory, 'fortweb', 'vendor', vendor_relative)

    if path.startswith('/fortweb/app/'):
        relative_path = path[len('/fortweb/app/'):]

        # Serve index.html from source.
        if not relative_path or relative_path == 'index.html':
            return os.path.join(directory, 'fortweb', 'app', relative_path or 'index.html')

        # Python runtime modules are not compiled. Serve them from source so
        # the dev-time /fortweb/ URL prefixes in wallet-worker.py and the
        # pyscript-ci [files] modules resolve against the libs-root doc root.
        if relative_path.endswith('.py'):
            source_app_path = os.path.join(directory, 'fortweb', 'app', relative_path)
            if os.path.exists(source_app_path):
                return source_app_path

        # Compiled/generated browser assets from dist/runtime.
        dist_app_path = os.path.join(directory, 'fortweb', 'dist', 'runtime', 'app', relative_path)
        if os.path.exists(dist_app_path):
            return dist_app_path

        dist_root_path = os.path.join(directory, 'fortweb', 'dist', 'runtime', relative_path)
        if os.path.exists(dist_root_path):
            return dist_root_path

        # Fallback to source app directory, then source root.
        source_app_path = os.path.join(directory, 'fortweb', 'app', relative_path)
        if os.path.exists(source_app_path):
            return source_app_path

        return os.path.join(directory, 'fortweb', relative_path)

    return None
