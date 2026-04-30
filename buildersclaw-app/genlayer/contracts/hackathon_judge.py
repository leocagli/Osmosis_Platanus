# { "Depends": "py-genlayer:latest" }

import json
from dataclasses import dataclass
from genlayer import *


@allow_storage
@dataclass
class Contender:
    team_id: str
    team_name: str
    repo_summary: str
    gemini_score: u256


@allow_storage
@dataclass
class JudgeResult:
    finalized: bool
    hackathon_id: str
    winner_team_id: str
    winner_team_name: str
    final_score: u256
    reasoning: str


class HackathonJudge(gl.Contract):
    """
    On-chain impartial hackathon judging via GenLayer's Optimistic Democracy.

    Flow:
    1. Owner deploys contract with hackathon metadata
    2. Owner submits top contenders (pre-filtered by off-chain scoring)
    3. Owner calls finalize() -> 5 validators independently pick a winner
    4. Consensus via Equivalence Principle: winner_team_id must match
    5. Result is verifiable on-chain by anyone

    This replaces single-LLM judging with decentralized multi-validator
    consensus - eliminating bias from any single AI model.
    """

    owner: Address
    hackathon_id: str
    title: str
    brief: str
    contenders: TreeMap[str, Contender]
    result: JudgeResult
    contenders_submitted: bool

    def __init__(self, hackathon_id: str, title: str, brief: str):
        self.owner = gl.message.sender_address
        self.hackathon_id = hackathon_id
        self.title = title
        self.brief = brief
        self.contenders_submitted = False
        self.result = JudgeResult(
            finalized=False,
            hackathon_id=hackathon_id,
            winner_team_id="",
            winner_team_name="",
            final_score=0,
            reasoning="",
        )

    def _only_owner(self):
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Only the contract owner can perform this action")

    @gl.public.write
    def submit_contenders(self, contenders_json: str) -> None:
        """
        Receive top contenders as a JSON string.
        Called after off-chain pre-scoring filters down to top N.
        """
        self._only_owner()
        if self.result.finalized:
            raise gl.vm.UserError("Judging already finalized")

        parsed = json.loads(contenders_json)
        if len(parsed) < 2:
            raise gl.vm.UserError("Need at least 2 contenders for fair judging")

        for c in parsed:
            self.contenders[c["team_id"]] = Contender(
                team_id=c["team_id"],
                team_name=c["team_name"],
                repo_summary=c.get("repo_summary", ""),
                gemini_score=u256(c.get("gemini_score", 0)),
            )
        self.contenders_submitted = True

    @gl.public.write
    def finalize(self) -> None:
        """
        Trigger LLM consensus among validators to pick the winner.

        Uses run_nondet_unsafe with a custom validator function:
        - Leader picks a winner via LLM analysis
        - Each validator independently picks their own winner
        - Consensus is reached if winner_team_id matches (Partial Field Matching)

        This is the recommended Equivalence Principle pattern for subjective
        decisions where the reasoning text will differ but the decision must agree.
        """
        self._only_owner()
        if self.result.finalized:
            raise gl.vm.UserError("Already finalized")
        if not self.contenders_submitted:
            raise gl.vm.UserError("No contenders submitted yet")

        # Build contender summaries for the prompt
        contender_list = []
        for team_id, c in self.contenders.items():
            contender_list.append({
                "team_id": c.team_id,
                "team_name": c.team_name,
                "gemini_score": int(c.gemini_score),
                "evaluation": c.repo_summary[:2000],
            })

        contenders_text = json.dumps(contender_list, indent=2)

        # Extract valid team IDs for validation
        valid_team_ids = [c["team_id"] for c in contender_list]

        def leader_fn() -> dict:
            """Leader validator evaluates all contenders and picks a winner."""
            task = f"""You are an impartial judge for the hackathon "{self.title}".

CHALLENGE BRIEF:
{self.brief}

CONTENDERS:
{contenders_text}

Each contender has:
- team_id / team_name: identification
- gemini_score: advisory pre-score from another AI (0-100), you may disagree
- evaluation: structured AI analysis of the submission

INSTRUCTIONS:
- Read each evaluation carefully.
- Pick the submission that BEST solves the challenge brief.
- Prioritize: brief compliance, functionality, completeness, code quality.
- You MUST pick exactly one winner.

Return ONLY this JSON:
{{
    "winner_team_id": "<team_id>",
    "winner_team_name": "<team_name>",
    "final_score": <0-100>,
    "reasoning": "<2-3 sentences why this team won>"
}}"""
            return gl.nondet.exec_prompt(task, response_format="json")

        def validator_fn(leader_result) -> bool:
            """
            Validator independently picks a winner and compares.
            Only the winner_team_id must match - reasoning will differ.
            This is Partial Field Matching (Pattern 1 from GenLayer docs).
            """
            if not isinstance(leader_result, gl.vm.Return):
                return False

            leader_data = leader_result.calldata

            # Validate leader picked a real contender
            if leader_data.get("winner_team_id") not in valid_team_ids:
                return False

            # Validator independently evaluates
            validator_data = leader_fn()

            # Consensus: same winner_team_id is enough
            # Reasoning and exact scores will naturally differ between LLMs
            return leader_data["winner_team_id"] == validator_data["winner_team_id"]

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        self.result = JudgeResult(
            finalized=True,
            hackathon_id=self.hackathon_id,
            winner_team_id=verdict["winner_team_id"],
            winner_team_name=verdict["winner_team_name"],
            final_score=u256(verdict.get("final_score", 0)),
            reasoning=verdict.get("reasoning", ""),
        )

    @gl.public.view
    def get_result(self) -> dict:
        """Return the current judging result. Callable by anyone."""
        return {
            "finalized": self.result.finalized,
            "hackathon_id": self.result.hackathon_id,
            "winner_team_id": self.result.winner_team_id,
            "winner_team_name": self.result.winner_team_name,
            "final_score": int(self.result.final_score),
            "reasoning": self.result.reasoning,
        }

    @gl.public.view
    def get_contenders(self) -> list:
        """Return all submitted contenders. Callable by anyone."""
        out = []
        for team_id, c in self.contenders.items():
            out.append({
                "team_id": c.team_id,
                "team_name": c.team_name,
                "gemini_score": int(c.gemini_score),
            })
        return out

    @gl.public.view
    def get_hackathon_info(self) -> dict:
        """Return hackathon metadata stored in the contract."""
        return {
            "hackathon_id": self.hackathon_id,
            "title": self.title,
            "brief": self.brief,
            "contenders_submitted": self.contenders_submitted,
            "finalized": self.result.finalized,
        }
