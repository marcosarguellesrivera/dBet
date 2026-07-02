const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  const forwarderAddress = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

  const dBet = await hre.ethers.getContractAt("DBet", contractAddress);

  console.log("Dando permisos al Forwarder de Chainlink CRE...");

  const tx = await dBet.setKeystoneForwarder(forwarderAddress);
  await tx.wait();

  console.log(
    "¡Permisos concedidos! El sistema ya puede inyectar datos de forma segura.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
