const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  const dBet = await hre.ethers.getContractAt("DBet", contractAddress);

  if (!contractAddress) {
    throw new Error("No CONTRACT_ADDRESS found in the .env file");
  }

  if (!apiKey)
    throw new Error("No FOOTBALL_DATA_API_KEY found in the .env file");

  let sourceCode = fs.readFileSync("./fetch-matches.js", "utf8");

  sourceCode = sourceCode.replace("__API_KEY__", apiKey);

  console.log("Uploading source code to the contract " + contractAddress);

  const tx = await dBet.setFetchMatchesSourceCode(sourceCode);
  await tx.wait();

  console.log("Source code uploaded");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
