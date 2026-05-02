"""
Direct mode tests for HackathonJudge contract.

These run in-memory with no server required. LLM calls are mocked.
Run with: uv run pytest tests/direct/ -v
"""

import json
import pytest

# ─── Fixtures / shared data ─────────────────────────────────────────────────

CONTRACT = "contracts/hackathon_judge.py"
HACKATHON_ID = "hack-001"
TITLE = "Build a DeFi Dashboard"
BRIEF = "Create a live dashboard showing key DeFi protocol metrics."

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

THREE_CONTENDERS = TWO_CONTENDERS + [
    {
        "team_id": "team-gamma",
        "team_name": "Gamma Collective",
        "repo_summary": "Deployed an on-chain aggregator with minimal gas overhead.",
        "gemini_score": 91,
    },
]

TWO_CONTENDERS_JSON = json.dumps(TWO_CONTENDERS)
THREE_CONTENDERS_JSON = json.dumps(THREE_CONTENDERS)

# LLM mock: always picks team-alpha as winner
MOCK_LLM_RESPONSE = json.dumps({
    "winner_team_id": "team-alpha",
    "winner_team_name": "Alpha Team",
    "final_score": 88,
    "reasoning": "Alpha team best solved the brief with superior functionality and brief compliance.",
})

# Matches the static "impartial judge" phrase in finalize()'s prompt
LLM_PATTERN = r".*impartial judge.*"


@pytest.fixture
def judge(direct_deploy):
    """Deploy a fresh HackathonJudge for each test."""
    return direct_deploy(CONTRACT, HACKATHON_ID, TITLE, BRIEF)


# ─── Deployment & initial state ──────────────────────────────────────────────

def test_deploy_stores_hackathon_metadata(judge):
    info = judge.get_hackathon_info()
    assert info["hackathon_id"] == HACKATHON_ID
    assert info["title"] == TITLE
    assert info["brief"] == BRIEF
    assert info["contenders_submitted"] is False
    assert info["finalized"] is False


def test_initial_result_is_empty(judge):
    result = judge.get_result()
    assert result["finalized"] is False
    assert result["winner_team_id"] == ""
    assert result["winner_team_name"] == ""
    assert result["final_score"] == 0
    assert result["hackathon_id"] == HACKATHON_ID


def test_initial_contenders_list_is_empty(judge):
    assert judge.get_contenders() == []


# ─── submit_contenders ───────────────────────────────────────────────────────

def test_submit_two_contenders_stores_them(judge):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    contenders = judge.get_contenders()
    assert len(contenders) == 2
    ids = {c["team_id"] for c in contenders}
    assert "team-alpha" in ids
    assert "team-beta" in ids


def test_submit_three_contenders_stores_them(judge):
    judge.submit_contenders(THREE_CONTENDERS_JSON)
    assert len(judge.get_contenders()) == 3


def test_submit_contenders_sets_submitted_flag(judge):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    assert judge.get_hackathon_info()["contenders_submitted"] is True


def test_submit_contenders_preserves_gemini_scores(judge):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    contenders = judge.get_contenders()
    scores = {c["team_id"]: c["gemini_score"] for c in contenders}
    assert scores["team-alpha"] == 82
    assert scores["team-beta"] == 78


def test_submit_one_contender_reverts(judge, direct_vm):
    one = json.dumps([TWO_CONTENDERS[0]])
    with direct_vm.expect_revert("Need at least 2 contenders"):
        judge.submit_contenders(one)


def test_submit_zero_contenders_reverts(judge, direct_vm):
    with direct_vm.expect_revert("Need at least 2 contenders"):
        judge.submit_contenders("[]")


def test_submit_contenders_non_owner_reverts(judge, direct_vm, direct_alice):
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("Only the contract owner"):
            judge.submit_contenders(TWO_CONTENDERS_JSON)


def test_submit_contenders_after_finalize_reverts(judge, direct_vm):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()
    with direct_vm.expect_revert("Judging already finalized"):
        judge.submit_contenders(TWO_CONTENDERS_JSON)


# ─── finalize ────────────────────────────────────────────────────────────────

def test_finalize_picks_winner_from_mock(judge, direct_vm):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()

    result = judge.get_result()
    assert result["finalized"] is True
    assert result["winner_team_id"] == "team-alpha"
    assert result["winner_team_name"] == "Alpha Team"
    assert result["final_score"] == 88
    assert len(result["reasoning"]) > 0


def test_finalize_updates_hackathon_info(judge, direct_vm):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()
    assert judge.get_hackathon_info()["finalized"] is True


def test_finalize_stores_hackathon_id_in_result(judge, direct_vm):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()
    assert judge.get_result()["hackathon_id"] == HACKATHON_ID


def test_finalize_without_contenders_reverts(judge, direct_vm):
    with direct_vm.expect_revert("No contenders submitted yet"):
        judge.finalize()


def test_finalize_non_owner_reverts(judge, direct_vm, direct_alice):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("Only the contract owner"):
            judge.finalize()


def test_finalize_twice_reverts(judge, direct_vm):
    judge.submit_contenders(TWO_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()
    with direct_vm.expect_revert("Already finalized"):
        judge.finalize()


def test_finalize_with_three_contenders(judge, direct_vm):
    """finalize() works with more than 2 contenders."""
    judge.submit_contenders(THREE_CONTENDERS_JSON)
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    judge.finalize()
    result = judge.get_result()
    assert result["finalized"] is True
    assert result["winner_team_id"] == "team-alpha"


# ─── Full end-to-end flow ────────────────────────────────────────────────────

def test_full_flow(direct_deploy, direct_vm):
    """Deploy → submit contenders → finalize → verify result."""
    contract = direct_deploy(CONTRACT, "e2e-hack", "E2E Test Hackathon", "Build something great.")

    # Before submission, everything empty
    assert contract.get_hackathon_info()["contenders_submitted"] is False
    assert contract.get_result()["finalized"] is False

    # Submit contenders
    contract.submit_contenders(TWO_CONTENDERS_JSON)
    assert len(contract.get_contenders()) == 2
    assert contract.get_hackathon_info()["contenders_submitted"] is True

    # Finalize with mocked LLM
    direct_vm.mock_llm(LLM_PATTERN, MOCK_LLM_RESPONSE)
    contract.finalize()

    # Verify final state
    result = contract.get_result()
    assert result["finalized"] is True
    assert result["winner_team_id"] == "team-alpha"
    assert result["final_score"] == 88
    assert contract.get_hackathon_info()["finalized"] is True
