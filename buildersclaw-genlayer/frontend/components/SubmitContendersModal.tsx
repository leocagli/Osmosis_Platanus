"use client";

import { useState } from "react";
import type { Contender } from "../lib/contracts/HackathonJudge";

interface SubmitContendersModalProps {
  onSubmit: (contenders: Contender[]) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

const SAMPLE_CONTENDERS: Contender[] = [
  {
    team_id: "team-alpha-001",
    team_name: "Alpha Builders",
    repo_url: "https://github.com/alpha/submission",
    gemini_score: 82,
    gemini_feedback: "Strong architecture, excellent brief compliance. Minor gaps in testing coverage.",
  },
  {
    team_id: "team-beta-002",
    team_name: "Beta Labs",
    repo_url: "https://github.com/beta/submission",
    gemini_score: 78,
    gemini_feedback: "Innovative approach with solid code quality. Documentation could be improved.",
  },
  {
    team_id: "team-gamma-003",
    team_name: "Gamma Squad",
    repo_url: "https://github.com/gamma/submission",
    gemini_score: 75,
    gemini_feedback: "Complete solution with good UX. Architecture is straightforward but effective.",
  },
];

export function SubmitContendersModal({ onSubmit, onClose, loading }: SubmitContendersModalProps) {
  const [jsonInput, setJsonInput] = useState(JSON.stringify(SAMPLE_CONTENDERS, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSubmit = async () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed) || parsed.length < 2) {
        setParseError("Need at least 2 contenders");
        return;
      }
      setParseError(null);
      await onSubmit(parsed);
    } catch (err) {
      setParseError("Invalid JSON format");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-xl font-bold">Submit Contenders</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Paste the JSON array of top contenders to submit to the on-chain judge.
          </p>
        </div>

        <div className="p-6 overflow-y-auto max-h-[50vh]">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 focus:outline-none focus:border-blue-500 resize-none"
            placeholder='[{"team_id": "...", "team_name": "...", ...}]'
          />
          {parseError && (
            <p className="mt-2 text-sm text-red-400">{parseError}</p>
          )}
        </div>

        <div className="p-6 border-t border-zinc-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit to Contract"}
          </button>
        </div>
      </div>
    </div>
  );
}
