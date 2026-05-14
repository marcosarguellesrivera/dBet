const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function updateEnvFile(newAddress, envPath, varName) {
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${varName}=${newAddress}\n`);
    return;
  }

  let envContent = fs.readFileSync(envPath, "utf8");
  const regex = new RegExp(`^${varName}\\s*=\\s*.*`, "m");

  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${varName}=${newAddress}`);
  } else {
    envContent += `\n${varName}=${newAddress}`;
  }

  fs.writeFileSync(envPath, envContent);
  console.log("Enviroment file updated");
}

async function main() {
  console.log("Deploying contract in Sepolia...");

  const router = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
  const donId =
    "0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000";
  const interval = 60;
  const subId = 6496;

  const dBet = await hre.ethers.deployContract("DBet", [
    router,
    donId,
    subId,
    interval,
  ]);

  await dBet.waitForDeployment();
  const address = await dBet.getAddress();

  console.log("Contract address:", address);
  updateEnvFile(address, path.join(__dirname, "../.env"), "CONTRACT_ADDRESS");
  updateEnvFile(
    address,
    path.join(__dirname, "../../frontend/.env.local"),
    "NEXT_PUBLIC_CONTRACT_ADDRESS",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
