"""Local runtime patches for GenLayer test tooling.

This repo currently uses `glsim` 0.28.0 for integration tests. That version's
`SimEngine.deploy()` caches the type returned by `gltest.direct.loader.deploy_contract()`,
but that helper returns a calldata proxy rather than the real contract instance.

When `glsim` later reuses the cached class, it tries to allocate storage for the
proxy class instead of the real contract class, which fails with:

    class is not marked for usage within storage, please, annotate it with @allow_storage

Python automatically imports `sitecustomize` on startup, so patching here keeps
the workaround local to this repo and applies to both `uv run glsim` and
`uv run gltest` when run from `genlayer/`.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


def _looks_like_contract_proxy(cls: object) -> bool:
    return isinstance(cls, type) and getattr(cls, "__slots__", ()) == ("_instance",)


def _resolve_contract_path(code_path: str) -> Path:
    path = Path(code_path).resolve()
    if path.exists():
        return path

    cwd = Path.cwd()
    for base in (cwd, cwd / "contracts"):
        candidate = (base / code_path).resolve()
        if candidate.exists():
            return candidate

    return path


try:
    import glsim.engine as _glsim_engine
except Exception:
    _glsim_engine = None


if _glsim_engine is not None and not getattr(
    _glsim_engine, "_buildersclaw_proxy_fix", False
):
    _original_deploy_contract = _glsim_engine.deploy_contract
    _original_simengine_deploy = _glsim_engine.SimEngine.deploy

    def _deploy_contract_unwrapped(*args, **kwargs):
        instance = _original_deploy_contract(*args, **kwargs)
        return getattr(instance, "_instance", instance)

    def _patched_simengine_deploy(self, code_path, args=None, kwargs=None, sender=None):
        path = _resolve_contract_path(code_path)
        path_key = str(path)
        cached_cls = self._class_cache.get(path_key)

        # Drop stale proxy entries left by the buggy cache path before deploy.
        if _looks_like_contract_proxy(cached_cls):
            self._class_cache.pop(path_key, None)
            try:
                code_hash = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
            except OSError:
                code_hash = None

            if code_hash and self._code_hash_cache.get(code_hash) is cached_cls:
                self._code_hash_cache.pop(code_hash, None)

        return _original_simengine_deploy(self, code_path, args, kwargs, sender)

    _glsim_engine.deploy_contract = _deploy_contract_unwrapped
    _glsim_engine.SimEngine.deploy = _patched_simengine_deploy
    _glsim_engine._buildersclaw_proxy_fix = True
