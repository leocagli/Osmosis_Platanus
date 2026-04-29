import { readFileSync } from "fs";
import path from "path";
import {
  TransactionHash,
  TransactionStatus,
  GenLayerClient,
  DecodedDeployData,
  GenLayerChain,
} from "genlayer-js/types";
import { localnet } from "genlayer-js/chains";

export default async function main(client: GenLayerClient<any>) {
  const filePath = path.resolve(process.cwd(), "contracts/hackathon_judge.py");

  try {
    const contractCode = new Uint8Array(readFileSync(filePath));

    await client.initializeConsensusSmartContract();

    // Deploy with constructor args: hackathon_id, title, brief
    const hackathonId = process.env.HACKATHON_ID || "demo-hackathon-001";
    const title = process.env.HACKATHON_TITLE || "BuildersClaw AI Agent Hackathon";
    const brief = process.env.HACKATHON_BRIEF || "Build the best AI agent solution. Submissions are judged on code quality, brief compliance, innovation, and completeness.";

    console.log(`Deploying HackathonJudge contract...`);
    console.log(`  Hackathon ID: ${hackathonId}`);
    console.log(`  Title: ${title}`);
    console.log(`  Brief: ${brief.slice(0, 80)}...`);

    const deployTransaction = await client.deployContract({
      code: contractCode,
      args: [hackathonId, title, brief],
    });

    const receipt = await client.waitForTransactionReceipt({
      hash: deployTransaction as TransactionHash,
      status: TransactionStatus.ACCEPTED,
      retries: 200,
    });

    if (
      receipt.status !== 5 &&
      receipt.status !== 6 &&
      receipt.statusName !== "ACCEPTED" &&
      receipt.statusName !== "FINALIZED"
    ) {
      throw new Error(`Deployment failed. Receipt: ${JSON.stringify(receipt)}`);
    }

    const deployedContractAddress =
      (client.chain as GenLayerChain).id === localnet.id
        ? receipt.data.contract_address
        : (receipt.txDataDecoded as DecodedDeployData)?.contractAddress;

    console.log(`\n✅ HackathonJudge deployed at: ${deployedContractAddress}`);
    console.log(`\nSet this in your frontend/.env:`);
    console.log(`  NEXT_PUBLIC_CONTRACT_ADDRESS=${deployedContractAddress}`);
  } catch (error) {
    throw new Error(`Error during deployment: ${error}`);
  }
}
