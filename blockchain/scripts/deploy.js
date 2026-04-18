const hre = require("hardhat");

async function main() {
  console.log("Desplegando contrato en Sepolia...");

  const router = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
  const donId = "0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000"; 
  const interval = 3600;
  const subId = 6496;

  const dBet = await hre.ethers.deployContract("DBet", [
    router,
    donId,
    subId,
    interval
  ]);

  await dBet.waitForDeployment();

  console.log("¡Contrato desplegado con éxito!");
  console.log("Dirección del contrato:", await dBet.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});