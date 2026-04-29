"use client";

import type { JudgeResult } from "../lib/contracts/HackathonJudge";

interface JudgeResultPanelProps {
  result: JudgeResult;
}

export function JudgeResultPanel({ result }: JudgeResultPanelProps) {
  if (!result.finalized) return null;

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-zinc-900/50 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">🔗</span>
        <h3 className="text-lg font-semibold text-emerald-400">On-Chain Verdict</h3>
        <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
          5 Validators · LLM Consensus
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Winner */}
        <div className="md:col-span-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Winner</p>
          <div className="flex items-center gap-3">
            <span className="text-4xl">🏆</span>
            <div>
              <h4 className="text-2xl font-bold text-white">{result.winner_team_name}</h4>
              <p className="text-sm text-zinc-500 font-mono">{result.winner_team_id}</p>
            </div>
          </div>
        </div>

        {/* Score */}
        <div className="text-center md:text-right">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Final Score</p>
          <p className="text-5xl font-bold text-emerald-400">{result.final_score}</p>
          <p className="text-xs text-zinc-500 mt-1">/ 100</p>
        </div>
      </div>

      {/* Reasoning */}
      {result.reasoning && (
        <div className="mt-6 rounded-lg bg-zinc-900/80 border border-zinc-800 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Validator Reasoning</p>
          <p className="text-sm text-zinc-300 leading-relaxed">{result.reasoning}</p>
        </div>
      )}

      {/* Trust Badge */}
      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
        <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span>Verified by GenLayer Optimistic Democracy — result is immutable and on-chain</span>
      </div>
    </section>
  );
}
