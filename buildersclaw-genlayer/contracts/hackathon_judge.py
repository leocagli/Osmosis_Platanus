# { "Depends": "py-genlayer:test" }

import json
from dataclasses import dataclass
from genlayer import *
from genlayer.gl.vm import UserError


@allow_storage
@dataclass
class Contender:
    team_id: str
    team_name: str
    repo_url: str
    repo_summary: str
    gemini_score: u256
    gemini_feedback: str


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
            raise UserError("Only the contract owner can perform this action")

    @gl.public.write
    def submit_contenders(self, contenders_json: str) -> None:
        """
        Receive top contenders as a JSON string.
        Called after Gemini pre-scoring filters down to the top 3.
        """
        self._only_owner()
        if self.result.finalized:
            raise UserError("Judging already finalized")

        parsed = json.loads(contenders_json)
        for c in parsed:
            self.contenders[c["team_id"]] = Contender(
                team_id=c["team_id"],
                team_name=c["team_name"],
                repo_url=c.get("repo_url", ""),
                repo_summary=c.get("repo_summary", ""),
                gemini_score=u256(c.get("gemini_score", 0)),
                gemini_feedback=c.get("gemini_feedback", ""),
            )
        self.contenders_submitted = True

    @gl.public.write
    def finalize(self) -> None:
        """
        Trigger LLM consensus among validators to pick the winner.
        Each validator independently evaluates all contenders and votes.
        The result is agreed upon via comparative equivalence principle.
        """
        self._only_owner()
        if self.result.finalized:
            raise UserError("Already finalized")
        if not self.contenders_submitted:
            raise UserError("No contenders submitted yet")

        # Build contender summaries for the prompt
        contender_list = []
        for team_id, c in self.contenders.items():
            contender_list.append({
                "team_id": c.team_id,
                "team_name": c.team_name,
                "repo_url": c.repo_url,
                "gemini_score": int(c.gemini_score),
                "gemini_feedback": c.gemini_feedback,
                "repo_summary": c.repo_summary[:8000],
            })

        verdict = self._judge_contenders(contender_list)

        self.result = JudgeResult(
            finalized=True,
            hackathon_id=self.hackathon_id,
            winner_team_id=verdict["winner_team_id"],
            winner_team_name=verdict["winner_team_name"],
            final_score=u256(verdict.get("final_score", 0)),
            reasoning=verdict.get("reasoning", ""),
        )

    def _judge_contenders(self, contender_list: list) -> dict:
        """
        Each validator runs this independently, then consensus is reached
        via comparative equivalence on the winner_team_id.
        """
        contenders_text = json.dumps(contender_list, indent=2)

        def pick_winner() -> str:
            task = f"""You are an impartial judge for the hackathon "{self.title}".

CHALLENGE BRIEF:
{self.brief}

CONTENDERS (pre-scored by Gemini, you must form your OWN opinion):
{contenders_text}

INSTRUCTIONS:
- Read each contender's repo summary and Gemini feedback carefully.
- Evaluate which submission BEST solves the challenge brief.
- Gemini scores are advisory only — you may disagree.
- Focus on: brief compliance, code quality, completeness, innovation.
- You MUST pick exactly one winner.

Respond in JSON only:
{{
    "winner_team_id": "<team_id of the winner>",
    "winner_team_name": "<team_name of the winner>",
    "final_score": <0-100 your score for the winner>,
    "reasoning": "<2-3 sentences explaining why this team won>"
}}

Respond ONLY with valid JSON. No markdown, no extra text."""

            result = gl.nondet.exec_prompt(task, response_format="json")
            return json.dumps(result, sort_keys=True)

        result_json = json.loads(
            gl.eq_principle.prompt_comparative(
                pick_winner,
                "The results are equivalent if they select the same winner_team_id",
            )
        )
        return result_json

    @gl.public.view
    def get_result(self) -> dict:
        """Return the current judging result."""
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
        """Return all submitted contenders."""
        out = []
        for team_id, c in self.contenders.items():
            out.append({
                "team_id": c.team_id,
                "team_name": c.team_name,
                "repo_url": c.repo_url,
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
