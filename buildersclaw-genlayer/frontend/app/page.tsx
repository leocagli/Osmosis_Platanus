"use client";

import { useState, useEffect, useCallback } from "react";
import { useHackathonJudge } from "../lib/hooks/useHackathonJudge";
import { useWallet } from "../lib/genlayer/WalletProvider";
import { AccountPanel } from "../components/AccountPanel";
import { ContendersPanel } from "../components/ContendersPanel";
import { JudgeResultPanel } from "../components/JudgeResultPanel";
import { SubmitContendersModal } from "../components/SubmitContendersModal";
import { Logo } from "../components/Logo";
import type {
  Contender,
  JudgeResult,
  HackathonInfo,
} from "../lib/contracts/HackathonJudge";

export default function Home() {
  const { address, isConnected } = useWallet();
  const {
    loading,
    error,
    contractAddress,
    getHackathonInfo,
    getContenders,
    getResult,
    submitContenders,
    finalize,
  } = useHackathonJudge(address || undefined);

  const [hackathonInfo, setHackathonInfo] = useState<HackathonInfo | null>(null);
  const [contenders, setContenders] = useState<Contender[]>([]);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!contractAddress) return;
    setRefreshing(true);
    try {
      const [info, cont, res] = await Promise.all([
        getHackathonInfo(),
        getContenders(),
        getResult(),
      ]);
      if (info) setHackathonInfo(info);
      if (cont) setContenders(cont);
      if (res) setResult(res);
    } catch (err) {
      console.error("Failed to refresh:", err);
    } finally {
      setRefreshing(false);
    }
  }, [contractAddress, getHackathonInfo, getContenders, getResult]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSubmitContenders = async (newContenders: Contender[]) => {
    const success = await submitContenders(newContenders);
    if (success) {
      setShowSubmitModal(false);
      await refresh();
    }
  };

  const handleFinalize = async () => {
    const finalResult = await finalize();
    if (finalResult) {
      setResult(finalResult);
      await refresh();
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-lg font-bold tracking-tight">BuildersClaw Judge</h1>
              <p className="text-xs text-zinc-500">On-Chain AI Consensus</p>
            </div>
          </div>
          <AccountPanel />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Contract Info */}
        {!contractAddress && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
            <h2 className="text-amber-400 font-semibold text-lg mb-2">⚠ No Contract Connected</h2>
            <p className="text-zinc-400 text-sm">
              Set <code className="bg-zinc-800 px-2 py-0.5 rounded text-amber-300">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in your <code className="bg-zinc-800 px-2 py-0.5 rounded">.env</code> file. Deploy with <code className="bg-zinc-800 px-2 py-0.5 rounded">npm run deploy</code>.
            </p>
          </div>
        )}

        {/* Hackathon Info */}
        {hackathonInfo && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Hackathon</p>
                <h2 className="text-2xl font-bold">{hackathonInfo.title}</h2>
                <p className="text-zinc-400 mt-2 max-w-2xl">{hackathonInfo.brief}</p>
                <div className="flex gap-3 mt-4">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300">
                    ID: {hackathonInfo.hackathon_id}
                  </span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    hackathonInfo.finalized
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : hackathonInfo.contenders_submitted
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {hackathonInfo.finalized
                      ? "✅ Finalized"
                      : hackathonInfo.contenders_submitted
                        ? "⏳ Awaiting Finalization"
                        : "📝 Awaiting Contenders"}
                  </span>
                </div>
              </div>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-2 rounded-lg hover:bg-zinc-800"
                title="Refresh"
              >
                <svg className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </section>
        )}

        {/* Result Panel — shown when finalized */}
        {result?.finalized && <JudgeResultPanel result={result} />}

        {/* Contenders */}
        <ContendersPanel
          contenders={contenders}
          winnerId={result?.finalized ? result.winner_team_id : undefined}
        />

        {/* Actions */}
        {isConnected && hackathonInfo && !hackathonInfo.finalized && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="text-lg font-semibold mb-4">Owner Actions</h3>
            <div className="flex gap-4">
              {!hackathonInfo.contenders_submitted && (
                <button
                  onClick={() => setShowSubmitModal(true)}
                  disabled={loading}
                  className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  Submit Contenders
                </button>
              )}
              {hackathonInfo.contenders_submitted && !hackathonInfo.finalized && (
                <button
                  onClick={handleFinalize}
                  disabled={loading}
                  className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Validators Judging...
                    </span>
                  ) : (
                    "🔗 Finalize — Trigger On-Chain Consensus"
                  )}
                </button>
              )}
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}
          </section>
        )}

        {/* How it Works */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-lg font-semibold mb-4">How On-Chain Judging Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: "1", title: "Pre-Score", desc: "Off-chain AI pre-evaluates all submissions and selects top contenders" },
              { step: "2", title: "Submit", desc: "Top contenders are submitted to the GenLayer Intelligent Contract" },
              { step: "3", title: "Consensus", desc: "5 independent validators with different LLMs each pick a winner" },
              { step: "4", title: "Verdict", desc: "Majority consensus determines the winner — verifiable on-chain" },
            ].map((item) => (
              <div key={item.step} className="text-center p-4">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-lg font-bold mx-auto mb-3">
                  {item.step}
                </div>
                <h4 className="font-semibold text-sm mb-1">{item.title}</h4>
                <p className="text-xs text-zinc-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-zinc-600 py-8">
          <p>Built on <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-300">GenLayer</a> — The Intelligence Layer of the Internet</p>
          <p className="mt-1">Powered by Optimistic Democracy consensus &amp; Equivalence Principle</p>
          {contractAddress && (
            <p className="mt-2">
              Contract: <a href={`https://explorer-bradbury.genlayer.com/address/${contractAddress}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 font-mono text-xs">{contractAddress.slice(0, 10)}...{contractAddress.slice(-8)}</a>
            </p>
          )}
        </footer>
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <SubmitContendersModal
          onSubmit={handleSubmitContenders}
          onClose={() => setShowSubmitModal(false)}
          loading={loading}
        />
      )}
    </main>
  );
}
