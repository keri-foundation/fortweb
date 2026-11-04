#!/usr/bin/env python3
"""Derive a pinned runtime source with static, bundle-owned side-module callbacks."""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

from build_runtime_source import canonical, digest, read_document, read_input


BASE_MANIFEST_SHA256 = "829a9f1bcbfc3eb34eda0aaadcf2a1725fef07b5c9323b069ea30c2f6d8e94a6"
PYODIDE_SHA256 = "f86edbb66b925ae933ff32ecdcb738ebde2ba926b6be3e485401587de7be89ea"
PYSCRIPT_SHA256 = "29d0aa103b85b8f17fb3ccaf5b1a2788bdb851378655ff9f39dd1c50270b171d"
SODIUM_SHA256 = "4a621780ba69ab435d7352ee13dfa9542888635ddbd6c1d7f6d3147b05fa39ce"
SODIUM_WHEEL = "pysodium-0.7.18-py3-none-pyemscripten_2026_0_wasm32.whl"
ASM_PREFIXES = (
    b"{ return Module.getRandomValue(); }",
    b"{ if (Module.getRandomValue === undefined)",
)
ASM_SHA256 = (
    "4abf7ad863800c83315077893d337a4373828012e732149af38a9c73efb18246",
    "71b61e62b9039d9b722795468a12a0645816ea1389503c6b6b94f14089ec9b02",
)
DEFAULT_HOOK = (
    '({interpreter:e})=>{e.registerJsModule("_pyscript",'
    '{fs:{ERROR:"storage permissions not granted",NAMESPACE:"@pyscript.fs"},interpreter:e})}'
)


def replace_once(source: bytes, original: bytes, replacement: bytes) -> bytes:
    if source.count(original) != 1:
        raise ValueError("expected runtime source differs or is ambiguous")
    return source.replace(original, replacement)


def patch_pyscript(source: bytes) -> bytes:
    if digest(source) != PYSCRIPT_SHA256:
        raise ValueError("unexpected PyScript bundle")
    original = b"return Function(`return(w,x)=>(${r})(w,x,...[${s}])`)()"
    hook = json.dumps(DEFAULT_HOOK, separators=(",", ":"))
    replacement = (
        f'if(e[`_${{t}}`]||t!=="onBeforeRunAsync"||n.length!==1||Co(n[0])!=={hook})'
        'throw new Error("Unsupported PyScript worker hook");return n[0]'
    ).encode()
    source = replace_once(source, original, replacement)
    original_revival = br"Dt=e=>Function(`\'use strict\';return (${e})`)()"
    revival = (
        f'Dt=e=>{{if(e!=={hook})throw new Error("Unsupported PyScript worker hook");'
        f'return {DEFAULT_HOOK}}}'
    )
    encoded_revival = json.dumps(revival, ensure_ascii=False)[1:-1].encode()
    return replace_once(source, original_revival, encoded_revival)


def extract_sodium_callbacks(wheel: bytes) -> list[str]:
    if digest(wheel) != SODIUM_SHA256:
        raise ValueError("unexpected pysodium wheel")
    with zipfile.ZipFile(io.BytesIO(wheel)) as archive:
        if archive.namelist().count("pysodium/libsodium.so") != 1:
            raise ValueError("wheel must contain exactly one libsodium module")
        module = archive.read("pysodium/libsodium.so")
    callbacks = []
    for prefix in ASM_PREFIXES:
        if module.count(prefix) != 1:
            raise ValueError("expected libsodium callback is missing or duplicated")
        start = module.index(prefix)
        end = module.find(b"\0", start)
        if end < 0 or end - start > 4096:
            raise ValueError("invalid libsodium callback")
        callbacks.append(module[start:end].decode("utf-8"))
    return callbacks


def patch_pyodide(source: bytes, callbacks: list[str]) -> bytes:
    if digest(source) != PYODIDE_SHA256:
        raise ValueError("unexpected Pyodide loader")
    if tuple(digest(body.encode()) for body in callbacks) != ASM_SHA256:
        raise ValueError("unexpected callback set")
    original = b"ASM_CONSTS[start]=eval(func)"
    if source.count(original) != 1:
        raise ValueError("unexpected Emscripten callback loader")
    clauses = []
    for body in callbacks:
        # The executable function is emitted at build time from a pinned wheel.
        clauses.append(f"if(body==={json.dumps(body)})return ()=>{{{body}}};")
    static_loader = (
        "ASM_CONSTS[start]=(()=>{" + "".join(clauses)
        + "throw new Error('Unsupported side-module JavaScript callback')})()"
    ).encode()
    return source.replace(original, static_loader)


def prepare(baseline: Path, output: Path) -> str:
    baseline = baseline.resolve()
    manifest_path = baseline / "manifest.json"
    manifest = read_document(manifest_path, BASE_MANIFEST_SHA256)
    rows = manifest.get("files")
    if not isinstance(rows, list):
        raise ValueError("baseline files missing")
    index = {row["path"]: row for row in rows}
    if len(index) != len(rows):
        raise ValueError("duplicate baseline file")
    loader = index["runtime/pyodide.asm.mjs"]
    wheel = index[f"wheelhouse/{SODIUM_WHEEL}"]
    loader_bytes = read_input(baseline, loader["path"], loader["sha256"], loader["bytes"])
    wheel_bytes = read_input(baseline, wheel["path"], wheel["sha256"], wheel["bytes"])
    patched = patch_pyodide(loader_bytes, extract_sodium_callbacks(wheel_bytes))

    output = output.absolute()
    if output.exists():
        raise ValueError("output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".csp-source-", dir=output.parent) as temporary:
        target = Path(temporary) / "payload"
        target.mkdir()
        result = copy.deepcopy(manifest)
        for row in result["files"]:
            data = read_input(baseline, row["path"], row["sha256"], row["bytes"])
            if row["path"] == loader["path"]:
                data = patched
                row.update(bytes=len(data), sha256=digest(data))
            path = target / row["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        result["csp_source_build"] = {
            "base_manifest_sha256": BASE_MANIFEST_SHA256,
            "original_pyodide_sha256": PYODIDE_SHA256,
            "pysodium_wheel_sha256": SODIUM_SHA256,
            "producer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        }
        manifest_bytes = canonical(result)
        (target / "manifest.json").write_bytes(manifest_bytes)
        os.rename(target, output)
    return digest(manifest_bytes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    print(prepare(arguments.baseline, arguments.output))
