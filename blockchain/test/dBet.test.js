const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Pruebas Unitarias - dBet Smart Contract", function () {
  let dBet;
  let owner, oracleForwarder, user1, user2, user3;
  let matchId;

  beforeEach(async function () {
    [owner, oracleForwarder, user1, user2, user3] = await ethers.getSigners();

    const DBetFactory = await ethers.getContractFactory("DBet");
    dBet = await DBetFactory.deploy();
    await dBet.waitForDeployment();

    await dBet.setKeystoneForwarder(oracleForwarder.address);
  });

  describe("1. Inicialización de Mercados (Oráculo)", function () {
    it("Debería permitir al Oráculo inyectar partidos futuros", async function () {
      const tomorrow = Math.floor(Date.now() / 1000) + 86400; // +1 día
      const apiMatchId = 101n;
      const teamA = 5n; 
      const teamB = 12n; 

      const packed =
        (BigInt(tomorrow) << 64n) |
        (apiMatchId << 32n) |
        (teamA << 16n) |
        teamB;

      const encoder = ethers.AbiCoder.defaultAbiCoder();
      const encodedData = encoder.encode(["uint256[]"], [[packed]]);

      await expect(dBet.connect(oracleForwarder).receiveMatches(encodedData))
        .to.emit(dBet, "MatchCreated")
        .withArgs(1, teamA, teamB, tomorrow);

      const matchData = await dBet.matches(1);
      expect(matchData.apiMatchId).to.equal(apiMatchId);
    });

    it("Debería revertir si una dirección no autorizada intenta inyectar partidos", async function () {
      const encoder = ethers.AbiCoder.defaultAbiCoder();
      const encodedData = encoder.encode(["uint256[]"], [[123456789n]]);

      await expect(
        dBet.connect(user1).receiveMatches(encodedData),
      ).to.be.revertedWith("Acceso denegado: Solo el Forwarder de CRE");
    });
  });

  describe("2. Gestión de Apuestas", function () {
    let futureTime;

    beforeEach(async function () {
      futureTime = Math.floor(Date.now() / 1000) + 3600;
      await dBet.createMatch(202, 1, 2, futureTime); 
      matchId = 1;
    });

    it("Debería registrar una apuesta válida al Equipo Local (1)", async function () {
      const betAmount = ethers.parseEther("0.1");

      await expect(dBet.connect(user1).bet(matchId, 1, { value: betAmount }))
        .to.emit(dBet, "BetPlaced")
        .withArgs(matchId, user1.address, 1, betAmount);

      const betInfo = await dBet.userBets(matchId, user1.address);
      expect(betInfo.amount).to.equal(betAmount);
      expect(betInfo.selectedTeam).to.equal(1n);
    });

    it("Debería revertir si la cantidad apostada es menor al mínimo", async function () {
      const lowAmount = ethers.parseEther("0.005");

      await expect(
        dBet.connect(user2).bet(matchId, 2, { value: lowAmount }),
      ).to.be.revertedWith("Cantidad apostada muy baja");
    });

    it("Debería revertir si el usuario intenta hacer una segunda apuesta al mismo partido", async function () {
      const betAmount = ethers.parseEther("0.05");

      await dBet.connect(user1).bet(matchId, 1, { value: betAmount });

      await expect(
        dBet.connect(user1).bet(matchId, 2, { value: betAmount }),
      ).to.be.revertedWith("Ya se ha apostado a este partido");
    });
  });

  describe("3. Resolución y Reclamación de Premios", function () {
    beforeEach(async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      await dBet.createMatch(303, 7, 8, futureTime);
      matchId = 1;

      await dBet
        .connect(user1)
        .bet(matchId, 1, { value: ethers.parseEther("1.0") });
      await dBet
        .connect(user2)
        .bet(matchId, 2, { value: ethers.parseEther("1.0") });
      await dBet
        .connect(user3)
        .bet(matchId, 3, { value: ethers.parseEther("2.0") });
    });

    it("Debería permitir reclamar el premio correctamente si el usuario acierta", async function () {
      await dBet.connect(oracleForwarder).resolveMatch(matchId, 1);

      const initialBalance = await ethers.provider.getBalance(user1.address);

      const tx = await dBet.connect(user1).claimReward(matchId);
      const receipt = await tx.wait();

      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(user1.address);

      const expectedBalance =
        initialBalance + ethers.parseEther("4.0") - gasUsed;

      expect(finalBalance).to.equal(expectedBalance);
    });

    it("Debería revertir el retiro si el usuario apostó al equipo perdedor", async function () {
      await dBet.connect(oracleForwarder).resolveMatch(matchId, 1);

      await expect(dBet.connect(user2).claimReward(matchId)).to.be.revertedWith(
        "No has obtenido ninguna recompensa",
      );
    });

    it("Debería revertir si el partido aún no ha sido resuelto por el oráculo", async function () {
      await expect(dBet.connect(user1).claimReward(matchId)).to.be.revertedWith(
        "Partido sin resolver",
      );
    });
  });
});
