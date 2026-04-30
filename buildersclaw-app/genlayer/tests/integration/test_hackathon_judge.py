"""
Integration tests for HackathonJudge contract against GLSim.

Run with:
    uv run gltest tests/integration/ -v -s

The test session starts its own GLSim instance via tests/integration/conftest.py.
"""

import json
from pathlib import Path

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

# ─── Shared data ────────────────────────────────────────────────────────────

CONTRACT_PATH = Path("hackathon_judge.py")

HACKATHON_ID = "hack-integ-001"
TITLE = "Build a DeFi Dashboard"
BRIEF = "Create a live dashboard showing key DeFi protocol metrics with real-time data."

TWO_CONTENDERS = [
    {
        "team_id": "team-alpha",
        "team_name": "Alpha Team",
        "repo_summary": "Built a robust REST API with full test coverage and clean architecture.",
        "gemini_score": 82,
    },
    {
        "team_id": "team-beta",
        "team_name": "Beta Squad",
        "repo_summary": "Created a polished UI with real-time data sync via WebSockets.",
        "gemini_score": 78,
    },
]

TWO_CONTENDERS_JSON = json.dumps(TWO_CONTENDERS)


# ─── Contract fixture ────────────────────────────────────────────────────────


@pytest.fixture
def judge_factory():
    return get_contract_factory(contract_file_path=CONTRACT_PATH)


@pytest.fixture
def judge(judge_factory):
    """Deploy a fresh contract for each test."""
    return judge_factory.deploy(args=[HACKATHON_ID, TITLE, BRIEF])


# ─── Deployment & read-only queries ─────────────────────────────────────────


def test_deploy_and_read_hackathon_info(judge):
    info = judge.get_hackathon_info(args=[]).call()
    assert info["hackathon_id"] == HACKATHON_ID
    assert info["title"] == TITLE
    assert info["contenders_submitted"] is False
    assert info["finalized"] is False


def test_initial_result_is_empty(judge):
    result = judge.get_result(args=[]).call()
    assert result["finalized"] is False
    assert result["winner_team_id"] == ""
    assert result["final_score"] == 0
    assert result["hackathon_id"] == HACKATHON_ID


def test_initial_contenders_list_is_empty(judge):
    contenders = judge.get_contenders(args=[]).call()
    assert contenders == []


# ─── submit_contenders ───────────────────────────────────────────────────────


def test_submit_contenders_succeeds(judge):
    receipt = judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    assert tx_execution_succeeded(receipt)


def test_submit_contenders_stores_data(judge):
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()

    contenders = judge.get_contenders(args=[]).call()
    assert len(contenders) == 2
    ids = {c["team_id"] for c in contenders}
    assert "team-alpha" in ids
    assert "team-beta" in ids


def test_submit_contenders_sets_flag(judge):
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    info = judge.get_hackathon_info(args=[]).call()
    assert info["contenders_submitted"] is True


def test_submit_contenders_preserves_gemini_scores(judge):
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    contenders = judge.get_contenders(args=[]).call()
    scores = {c["team_id"]: c["gemini_score"] for c in contenders}
    assert scores["team-alpha"] == 82
    assert scores["team-beta"] == 78


def test_submit_one_contender_fails(judge):
    one = json.dumps([TWO_CONTENDERS[0]])
    receipt = judge.submit_contenders(args=[one]).transact()
    assert tx_execution_failed(receipt)


# ─── finalize ────────────────────────────────────────────────────────────────


def test_finalize_succeeds(judge):
    """
    Full flow: submit contenders → finalize.
    GLSim uses the LLM mock installed in conftest to return a deterministic winner.
    """
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    receipt = judge.finalize(args=[]).transact()
    assert tx_execution_succeeded(receipt)


def test_finalize_sets_winner(judge):
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    judge.finalize(args=[]).transact()

    result = judge.get_result(args=[]).call()
    assert result["finalized"] is True
    assert result["winner_team_id"] == "team-alpha"
    assert result["winner_team_name"] == "Alpha Team"
    assert result["final_score"] == 88
    assert len(result["reasoning"]) > 0


def test_finalize_without_contenders_fails(judge):
    receipt = judge.finalize(args=[]).transact()
    assert tx_execution_failed(receipt)


def test_finalize_twice_fails(judge):
    judge.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    judge.finalize(args=[]).transact()
    receipt = judge.finalize(args=[]).transact()
    assert tx_execution_failed(receipt)


# ─── Full end-to-end flow ────────────────────────────────────────────────────


def test_full_flow(judge_factory):
    """
    Complete lifecycle: deploy → submit → finalize → read result.
    Mirrors what src/lib/genlayer.ts does in production.
    """
    contract = judge_factory.deploy(
        args=["e2e-hack", "E2E Hackathon", "Build something great."]
    )

    # Initial state
    info = contract.get_hackathon_info(args=[]).call()
    assert info["contenders_submitted"] is False

    # Submit
    receipt = contract.submit_contenders(args=[TWO_CONTENDERS_JSON]).transact()
    assert tx_execution_succeeded(receipt)

    contenders = contract.get_contenders(args=[]).call()
    assert len(contenders) == 2

    # Finalize
    receipt = contract.finalize(args=[]).transact()
    assert tx_execution_succeeded(receipt)

    # Verify
    result = contract.get_result(args=[]).call()
    assert result["finalized"] is True
    assert result["winner_team_id"] != ""
    assert result["final_score"] > 0
