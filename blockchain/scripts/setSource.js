const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const dBet = await hre.ethers.getContractAt("DBet", contractAddress);

  if (!contractAddress) {
    throw new Error("No se encuentra CONTRACT_ADDRESS en el .env");
  }

  const sourceCode = fs.readFileSync("./fetch-matches.js", "utf8");

  console.log("Uploading source code to the contract " + contractAddress);

  const tx = await dBet.setFetchMatchesSourceCode(sourceCode);
  await tx.wait();

  console.log("Source code uploaded");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
