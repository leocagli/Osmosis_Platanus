"use client";

import { useState, useCallback } from "react";
import { createGenLayerClient, getContractAddress } from "../genlayer/client";
import type {
  Contender,
  JudgeResult,
  HackathonInfo,
} from "../contracts/HackathonJudge";
import {
  TransactionStatus,
  type TransactionHash,
} from "genlayer-js/types";

/**
 * React hook for interacting with the HackathonJudge contract.
 *
 * Provides methods for:
 * - Reading hackathon info, contenders, and results (view, free)
 * - Submitting contenders and finalizing judging (write, requires wallet)
 */
export function useHackathonJudge(walletAddress?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getClient = useCallback(() => {
    return createGenLayerClient(walletAddress);
  }, [walletAddress]);

  const contractAddress = getContractAddress();

  // ─── View methods ───

  const getHackathonInfo = useCallback(async (): Promise<HackathonInfo | null> => {
    try {
      setError(null);
      const client = getClient();
      const result = await client.readContract({
        address: contractAddress as `0x${string}`,
        functionName: "get_hackathon_info",
        args: [],
      });
      return result as unknown as HackathonInfo;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [getClient, contractAddress]);

  const getContenders = useCallback(async (): Promise<Contender[]> => {
    try {
      setError(null);
      const client = getClient();
      const result = await client.readContract({
        address: contractAddress as `0x${string}`,
        functionName: "get_contenders",
        args: [],
      });
      return (result as unknown as Contender[]) || [];
    } catch (err: any) {
      setError(err.message);
      return [];
    }
  }, [getClient, contractAddress]);

  const getResult = useCallback(async (): Promise<JudgeResult | null> => {
    try {
      setError(null);
      const client = getClient();
      const result = await client.readContract({
        address: contractAddress as `0x${string}`,
        functionName: "get_result",
        args: [],
      });
      return result as unknown as JudgeResult;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [getClient, contractAddress]);

  // ─── Write methods ───

  const submitContenders = useCallback(
    async (contenders: Contender[]): Promise<boolean> => {
      try {
        setLoading(true);
        setError(null);
        const client = getClient();

        const hash = await client.writeContract({
          address: contractAddress as `0x${string}`,
          functionName: "submit_contenders",
          args: [JSON.stringify(contenders)],
          value: BigInt(0),
        });

        const receipt = await client.waitForTransactionReceipt({
          hash: hash as TransactionHash,
          status: TransactionStatus.ACCEPTED,
          retries: 120,
        });

        return (
          receipt.statusName === "ACCEPTED" ||
          receipt.statusName === "FINALIZED"
        );
      } catch (err: any) {
        setError(err.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [getClient, contractAddress]
  );

  const finalize = useCallback(async (): Promise<JudgeResult | null> => {
    try {
      setLoading(true);
      setError(null);
      const client = getClient();

      const hash = await client.writeContract({
        address: contractAddress as `0x${string}`,
        functionName: "finalize",
        args: [],
        value: BigInt(0),
      });

      // Finalize takes longer — validators need to run LLM consensus
      const receipt = await client.waitForTransactionReceipt({
        hash: hash as TransactionHash,
        status: TransactionStatus.ACCEPTED,
        retries: 300, // Up to ~10 min for LLM consensus
      });

      if (
        receipt.statusName === "ACCEPTED" ||
        receipt.statusName === "FINALIZED"
      ) {
        return await getResult();
      }

      setError(`Transaction failed: ${receipt.statusName}`);
      return null;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [getClient, contractAddress, getResult]);

  return {
    // State
    loading,
    error,
    contractAddress,

    // View methods
    getHackathonInfo,
    getContenders,
    getResult,

    // Write methods
    submitContenders,
    finalize,
  };
}
