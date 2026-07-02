const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!contractAddress || !apiKey) {
    throw new Error("Faltan variables de entorno");
  }

  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);

  const dateFrom = today.toISOString().split("T")[0];
  const dateTo = nextWeek.toISOString().split("T")[0];

  console.log(`Conectando al contrato DBet en Sepolia: ${contractAddress}`);
  const dBet = await hre.ethers.getContractAt("DBet", contractAddress);

  const url = `https://api.football-data.org/v4/matches?status=SCHEDULED&dateFrom=${dateFrom}&dateTo=${dateTo}`;

  const response = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!response.ok) {
    throw new Error(
      `Error en la API: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const matches = data.matches;

  if (!matches || matches.length === 0) {
    console.log("No hay partidos programados en esas fechas");
  } else {
    let packedMatches = [];

    const nowTimestamp = BigInt(Math.floor(Date.now() / 1000));

    for (let i = 0; i < Math.min(15, matches.length); i++) {
      const match = matches[i];

      if (
        !match.id ||
        !match.homeTeam ||
        match.homeTeam.id === null ||
        !match.awayTeam ||
        match.awayTeam.id === null
      ) {
        console.log(
          `Saltado partido ${
            match.id || "Desconocido"
          } ignorado por equipos no definidos (TBD).`,
        );
        continue;
      }

      const startTime = BigInt(
        Math.floor(new Date(match.utcDate).getTime() / 1000),
      );

      if (startTime <= nowTimestamp + 300n) {
        console.log(`Saltado partido ${match.id}`);
        continue;
      }

      const apiMatchId = BigInt(match.id);
      const teamAId = BigInt(match.homeTeam.id);
      const teamBId = BigInt(match.awayTeam.id);

      const packed =
        (startTime << 64n) | (apiMatchId << 32n) | (teamAId << 16n) | teamBId;
      packedMatches.push(packed);
    }

    if (packedMatches.length === 0) {
      console.log("No quedan partidos válidos para empaquetar");
    } else {
      const encoder = new hre.ethers.AbiCoder();
      const encodedData = encoder.encode(["uint256[]"], [packedMatches]);

      try {
        console.log(`Enviando ${packedMatches.length} partidos al contrato`);
        const tx = await dBet.receiveMatches(encodedData);
        console.log(`Hash: ${tx.hash}`);
        await tx.wait();
        console.log("Partidos mapeados");
      } catch (injError) {
        console.log(injError.message);
      }
    }
  }

  const pastWeek = new Date();
  pastWeek.setDate(today.getDate() - 7);
  const pastDateFrom = pastWeek.toISOString().split("T")[0];

  const finishedUrl = `https://api.football-data.org/v4/matches?status=FINISHED&dateFrom=${pastDateFrom}&dateTo=${dateFrom}`;

  console.log("\nBuscando partidos finalizados recientemente para resolver...");
  const responseFinished = await fetch(finishedUrl, {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!responseFinished.ok) {
    throw new Error(
      `Error en la API: ${responseFinished.status} ${responseFinished.statusText}`,
    );
  }

  const dataFinished = await responseFinished.json();
  const finishedMatches = dataFinished.matches;

  if (!finishedMatches || finishedMatches.length === 0) {
    console.log(
      "No hay partidos finalizados en la última semana para resolver.",
    );
    return;
  }

  const totalContractMatches = await dBet.matchCounter();

  for (let i = 0; i < finishedMatches.length; i++) {
    const fMatch = finishedMatches[i];

    if (!fMatch.id || !fMatch.score || fMatch.score.winner === null) {
      continue;
    }

    const apiMatchId = BigInt(fMatch.id);

    let outcome = 0;
    if (fMatch.score.winner === "HOME_TEAM") outcome = 1;
    else if (fMatch.score.winner === "AWAY_TEAM") outcome = 2;
    else if (fMatch.score.winner === "DRAW") outcome = 3;

    if (outcome !== 0) {
      let internalMatchId = 0;
      let alreadyResolved = false;

      for (let j = 1; j <= Number(totalContractMatches); j++) {
        const contractMatch = await dBet.matches(j);
        if (BigInt(contractMatch.apiMatchId) === apiMatchId) {
          internalMatchId = j;
          alreadyResolved = contractMatch.isResolved;
          break;
        }
      }

      if (internalMatchId !== 0 && !alreadyResolved) {
        console.log(
          `Partido: ${fMatch.homeTeam.name} vs ${fMatch.awayTeam.name} | ID: ${internalMatchId}`,
        );

        try {
          const settleTx = await dBet.resolveMatch(internalMatchId, outcome);
          console.log(`Hash: ${settleTx.hash}`);
          await settleTx.wait();
          console.log(`Partido ${internalMatchId} cerrado`);
        } catch (contractError) {
          console.error(contractError.message);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error("Error fatal en el oráculo simulado:", error);
  process.exitCode = 1;
});
