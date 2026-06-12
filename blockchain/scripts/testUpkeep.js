const hre = require("hardhat");

async function main() {
  const dBet = await hre.ethers.getContractAt(
    "DBet",
    process.env.CONTRACT_ADDRESS,
  );

  console.log("Analizando el estado del contrato...");

  let performData = "0x";
  let upkeepNeeded = false;

  try {
    const checkResult = await dBet.checkUpkeep("0x");
    upkeepNeeded = checkResult[0];
    performData = checkResult[1];
    console.log("upkeepNeeded?", upkeepNeeded);

    if (!upkeepNeeded) {
      console.log(
        "No hay tareas pendientes (No upkeep needed). El contrato está al día.",
      );
      return;
    }
  } catch (error) {
    console.log("checkUpkeep falló:", error.message);
    return;
  }

  try {
    console.log(`Enviando performUpkeep con datos: ${performData}`);

    const tx = await dBet.performUpkeep(performData, {
      gasLimit: 2000000,
    });

    console.log("Transaction sent. Hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("¡Request sent to Chainlink Functions con éxito!");
  } catch (error) {
    console.log("Transaction failed");
    console.error(error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
