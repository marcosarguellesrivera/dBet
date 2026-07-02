const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("Falta CONTRACT_ADDRESS en el .env");

  const [deployer] = await hre.ethers.getSigners();

  console.log(`Conectando al contrato en: ${contractAddress}`);
  const dBet = await hre.ethers.getContractAt("DBet", contractAddress);

  const tx = await dBet.setKeystoneForwarder(deployer.address);
  await tx.wait();

  console.log("Permisos concedidos");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
