import { Workflow } from "@chainlink/cre-sdk";
import { ethers } from "ethers";

export const injectMatchesWorkflow = new Workflow({
  trigger: {
    type: "cron",
    config: { schedule: "0 */12 * * *" },
  },

  execute: async (context) => {
    console.log("Iniciando flujo de inyección de partidos CRE...");

    const apiKey = context.secrets.get("API_KEY");
    if (!apiKey)
      throw new Error("API_KEY no encontrada en el gestor de secretos.");

    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    const dateFrom = today.toISOString().split("T")[0];
    const dateTo = nextWeek.toISOString().split("T")[0];

    const url = `https://api.football-data.org/v4/matches?&status=SCHEDULED&dateFrom=${dateFrom}&dateTo=${dateTo}`;

    const response = await context.capabilities.http.get({
      url: url,
      headers: { "X-Auth-Token": apiKey },
    });

    const matches = response.data.matches;

    if (!matches || matches.length === 0) {
      console.log(
        "No hay partidos programados para inyectar. Terminando workflow.",
      );
      return;
    }

    const matchesToProcess = matches.slice(0, 3);
    const packedMatches: bigint[] = [];

    for (const match of matchesToProcess) {
      const apiMatchId = BigInt(match.id);
      const teamA = BigInt(match.homeTeam.id);
      const teamB = BigInt(match.awayTeam.id);
      const startTime = BigInt(
        Math.floor(new Date(match.utcDate).getTime() / 1000),
      );

      const packed =
        (startTime << 64n) | (apiMatchId << 32n) | (teamA << 16n) | teamB;
      packedMatches.push(packed);
    }

    const abiCoder = new ethers.AbiCoder();
    const payload = abiCoder.encode(["uint256[]"], [packedMatches]);

    console.log(`Enviando ${packedMatches.length} partidos a la blockchain...`);

    await context.capabilities.evm.write({
      targetAddress: context.env.get("CONTRACT_ADDRESS"),
      functionSignature: "receiveMatches(bytes)",
      args: [payload],
    });

    console.log("Flujo completado con éxito.");
  },
});
