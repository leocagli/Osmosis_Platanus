"use client";

import type { Contender } from "../lib/contracts/HackathonJudge";

interface ContendersPanelProps {
  contenders: Contender[];
  winnerId?: string;
}

export function ContendersPanel({ contenders, winnerId }: ContendersPanelProps) {
  if (contenders.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h3 className="text-lg font-semibold mb-2">Contenders</h3>
        <p className="text-zinc-500 text-sm">No contenders submitted yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h3 className="text-lg font-semibold mb-4">
        Contenders <span className="text-zinc-500 text-sm font-normal">({contenders.length})</span>
      </h3>
      <div className="space-y-3">
        {contenders.map((c) => {
          const isWinner = winnerId && c.team_id === winnerId;
          return (
            <div
              key={c.team_id}
              className={`rounded-lg border p-4 transition-all ${
                isWinner
                  ? "border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                  : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isWinner && (
                    <span className="text-2xl" title="Winner">🏆</span>
                  )}
                  <div>
                    <h4 className="font-semibold">
                      {c.team_name}
                      {isWinner && (
                        <span className="ml-2 text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                          WINNER
                        </span>
                      )}
                    </h4>
                    <p className="text-xs text-zinc-500 font-mono">{c.team_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">Pre-Score</p>
                    <p className={`text-lg font-bold ${
                      c.gemini_score >= 70 ? "text-emerald-400" :
                      c.gemini_score >= 50 ? "text-amber-400" : "text-red-400"
                    }`}>
                      {c.gemini_score}
                    </p>
                  </div>
                  {c.repo_url && (
                    <a
                      href={c.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="View Repository"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
              {c.gemini_feedback && (
                <p className="mt-3 text-sm text-zinc-400 line-clamp-2">{c.gemini_feedback}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
