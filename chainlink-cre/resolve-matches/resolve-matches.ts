import { Workflow } from "@chainlink/cre-sdk";
import { ethers } from "ethers";

export const resolveMatchesWorkflow = new Workflow({
  trigger: {
    type: "cron",
    config: { schedule: "0 * * * *" },
  },

  execute: async (context) => {
    console.log("Iniciando flujo de resolución de partidos...");

    const contractAddress = context.env.get("CONTRACT_ADDRESS");
    const rpcUrl = context.env.get("RPC_URL");
    const apiKey = context.secrets.get("API_KEY");

    if (!apiKey || !rpcUrl)
      throw new Error(
        "Faltan variables de entorno o secretos (API_KEY o RPC_URL).",
      );

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const abi = [
      "function nextMatchToResolve() view returns (uint256)",
      "function matches(uint256) view returns (uint256, uint256, uint256, uint32, uint16, uint16, uint16, bool, bool, bool)",
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);

    const matchId = await contract.nextMatchToResolve();
    const matchData = await contract.matches(matchId);

    const apiMatchId = matchData[3];
    const isResolved = matchData[7];

    if (isResolved || apiMatchId === 0n) {
      console.log(
        "No hay partidos pendientes de resolver o el sistema está al día.",
      );
      return;
    }

    console.log(
      `Auditando el partido interno ID: ${matchId} (API ID: ${apiMatchId})`,
    );

    const url = `https://api.football-data.org/v4/matches/${apiMatchId}`;
    const response = await context.capabilities.http.get({
      url: url,
      headers: { "X-Auth-Token": apiKey },
    });

    const match = response.data;

    if (match.status !== "FINISHED") {
      console.log(
        `El partido aún no ha terminado. Estado actual: ${match.status}`,
      );
      return;
    }

    const homeScore = match.score.fullTime.home;
    const awayScore = match.score.fullTime.away;

    let winningTeam = 3;
    if (homeScore > awayScore) {
      winningTeam = 1;
    } else if (awayScore > homeScore) {
      winningTeam = 2;
    }

    console.log(
      `Resultado final: ${homeScore} - ${awayScore}. Ganador determinado: ${winningTeam}`,
    );

    await context.capabilities.evm.write({
      targetAddress: contractAddress,
      functionSignature: "resolveMatch(uint256,uint16)",
      args: [matchId, winningTeam],
    });

    console.log("Partido resuelto en la blockchain con éxito.");
  },
});
