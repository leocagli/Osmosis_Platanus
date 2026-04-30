"""Shared fixtures for HackathonJudge integration tests against GLSim."""

import json
import os
import subprocess
import time
from pathlib import Path

import pytest
import requests

ROOT = Path(__file__).resolve().parents[2]
GLSIM_PORT = 4001
GLSIM_URL = f"http://127.0.0.1:{GLSIM_PORT}/api"

# LLM mock installed server-side so finalize() gets a deterministic response
MOCK_WINNER = {
    "winner_team_id": "team-alpha",
    "winner_team_name": "Alpha Team",
    "final_score": 88,
    "reasoning": "Alpha team best solved the challenge with superior functionality and brief compliance.",
}


def _rpc(method, params=None):
    resp = requests.post(
        GLSIM_URL,
        json={"jsonrpc": "2.0", "method": method, "params": params or [], "id": 1},
        timeout=5,
    )
    resp.raise_for_status()
    return resp.json()


def _glsim_running() -> bool:
    try:
        result = _rpc("eth_chainId")
        return "result" in result
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def manage_glsim():
    """Run a dedicated GLSim instance for this test session."""
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        f"{ROOT}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else str(ROOT)
    )

    proc = subprocess.Popen(
        ["uv", "run", "glsim", "--port", str(GLSIM_PORT), "--validators", "5"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + 20
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("GLSim exited before becoming ready")
        if _glsim_running():
            break
        time.sleep(0.25)
    else:
        proc.terminate()
        raise RuntimeError("Timed out waiting for GLSim to start")

    try:
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.fixture(scope="session", autouse=True)
def install_llm_mocks(manage_glsim):
    """
    Install persistent LLM mocks in GLSim once for the session.
    The mock matches the 'impartial judge' phrase in finalize()'s prompt
    and returns a deterministic JSON winner so tests don't need a real LLM.
    """
    _rpc(
        "sim_installMocks",
        {
            "llm_mocks": {
                ".*impartial judge.*": json.dumps(MOCK_WINNER),
            },
            "strict": True,
        },
    )
    yield
    # Reset mocks after session
    _rpc("sim_installMocks", {"llm_mocks": {}, "web_mocks": {}, "strict": False})
