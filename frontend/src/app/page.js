"use client";
import { useState, useEffect, useRef } from "react";
import { Contract, ethers } from "ethers";
import detectEthereumProvider from "@metamask/detect-provider";
import { decodeError } from "@ubiquity-os/ethers-decode-error";

import DBetManifest from "../contracts/DBet.json";

const CONTRACT_ADDRESS = "0x772575E330C1385aEe86253aC9308f910d29983D";

export default function Home() {
  const contractRef = useRef(null);
  const signerRef = useRef(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [account, setAccount] = useState("");
  const [matches, setMatches] = useState([]);

  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [matchDate, setMatchDate] = useState("");

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [betAmount, setBetAmount] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("1");

  useEffect(() => {
    if (window.ethereum) {
      configureBlockchain();
    }
  }, []);

  const configureBlockchain = async () => {
    try {
      const rawProvider = await detectEthereumProvider();

      try {
        // Le pedimos a MetaMask que cambie a Sepolia
        const sepoliaChainId = "0xaa36a7";
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sepoliaChainId }],
        });
      } catch (switchError) {
        // Si da error, detenemos la ejecución
        console.error("El usuario no cambió a Sepolia:", switchError);
        setErrorMessage("Debes cambiar a la red Sepolia para usar esta DApp.");
        return;
      }

      const provider = new ethers.providers.Web3Provider(rawProvider);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);

      const signer = await provider.getSigner();
      signerRef.current = signer;

      contractRef.current = new Contract(
        CONTRACT_ADDRESS,
        DBetManifest.abi,
        signer,
      );

      await fetchMatches();
    } catch (error) {
      console.error("Error conectando MetaMask:", error);
      setErrorMessage("Por favor, instala y conecta MetaMask.");
    }
  };

  const fetchMatches = async () => {
    try {
      if (!contractRef.current) return;

      const counter = await contractRef.current.matchCounter();
      const totalMatches = Number(counter);

      let loadedMatches = [];
      for (let i = 1; i <= totalMatches; i++) {
        const matchData = await contractRef.current.matches(i);
        loadedMatches.push({
          id: i,
          teamA: Number(matchData.teamA),
          teamB: Number(matchData.teamB),
          isResolved: matchData.isResolved,
          winningTeam: Number(matchData.winningTeam),
          startTime: Number(matchData.startTime),
        });
      }
      setMatches(loadedMatches);
    } catch (error) {
      let decoded = decodeError(error);
      setErrorMessage(decoded.error || "Error al obtener partidos");
    }
  };

  const createMatch = async () => {
    try {
      setErrorMessage("");
      const startTimeUnix = Math.floor(new Date(matchDate).getTime() / 1000);

      const tx = await contractRef.current.createMatch(
        parseInt(teamA),
        parseInt(teamB),
        startTimeUnix,
      );
      await tx.wait();

      setTeamA("");
      setTeamB("");
      setMatchDate("");
      await fetchMatches();
    } catch (error) {
      let decoded = decodeError(error);
      setErrorMessage(decoded.error || "Error al crear el partido");
    }
  };

  const placeBet = async () => {
    if (!selectedMatch) return;
    try {
      setErrorMessage("");
      const parsedAmount = ethers.utils.parseEther(betAmount.toString());

      const tx = await contractRef.current.bet(
        selectedMatch.id,
        parseInt(selectedTeam),
        {
          value: parsedAmount,
        },
      );
      await tx.wait();

      setBetAmount("");
      alert("¡Apuesta realizada con éxito!");
    } catch (error) {
      if (error?.message?.includes("insufficient funds")) {
        setErrorMessage(
          "Saldo insuficiente en tu wallet para hacer esta apuesta o pagar el gas.",
        );
        return;
      }
      let decoded = decodeError(error);
      setErrorMessage(decoded.error || "Error al realizar la apuesta");
    }
  };

  const claimReward = async () => {
    if (!selectedMatch) return;
    try {
      setErrorMessage("");
      const tx = await contractRef.current.claimReward(selectedMatch.id);
      await tx.wait();
      alert("¡Premio reclamado!");
    } catch (error) {
      let decoded = decodeError(error);
      setErrorMessage(decoded.error || "Error al reclamar las ganancias");
    }
  };
  return (
    <div className="container">
      {/* HEADER */}
      <div className="header">
        <h1 className="title">⚽ DBet</h1>
        {!account ? (
          <button onClick={configureBlockchain}>Conectar MetaMask</button>
        ) : (
          <div className="wallet-badge">
            🟢 {account.substring(0, 6)}...{account.substring(38)}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="error-message">
          <span>{errorMessage}</span>
          <button
            className="close-error-btn"
            onClick={() => setErrorMessage("")}
            title="Cerrar mensaje"
          >
            &times;
          </button>
        </div>
      )}

      <div className="card">
        <h2>🛠️ Crear Nuevo Partido (Admin)</h2>
        <div className="form-group">
          <input
            type="number"
            placeholder="ID Equipo Local"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
          />
          <input
            type="number"
            placeholder="ID Equipo Visitante"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
          />
          <input
            type="datetime-local"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
          />
          <button onClick={createMatch}>Programar Partido</button>
        </div>
      </div>

      <div className="card">
        <h2>🏆 Partidos Disponibles</h2>
        {matches.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>
            No hay partidos activos en este momento.
          </p>
        ) : (
          <ul className="match-list">
            {matches.map((match) => {
              // COMPROBACIÓN DE TIEMPO Y ESTADO
              const currentTime = Math.floor(Date.now() / 1000);
              const hasStarted = currentTime >= match.startTime;

              let statusText = "Abierto para apuestas";
              let statusClass = "status-open";

              if (match.isResolved) {
                statusText = "Finalizado";
                statusClass = "status-resolved";
              } else if (hasStarted) {
                statusText = "En juego (Cerrado)";
                statusClass = "status-playing";
              }

              return (
                <li
                  key={match.id}
                  className="match-item"
                  onClick={() => setSelectedMatch(match)}
                >
                  <div>
                    <strong>Partido #{match.id}:</strong> Equipo {match.teamA}{" "}
                    vs Equipo {match.teamB}
                  </div>
                  <span className={`match-status ${statusClass}`}>
                    {statusText}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedMatch && (
        <div className="card" style={{ border: "1px solid var(--primary)" }}>
          <h2>Detalles del Partido #{selectedMatch.id}</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "20px" }}>
            <strong>Inicio:</strong>{" "}
            {new Date(selectedMatch.startTime * 1000).toLocaleString()}
          </p>

          {selectedMatch.isResolved && selectedMatch.winningTeam !== 0 && (
            <div
              style={{
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                padding: "10px",
                borderRadius: "8px",
                marginBottom: "20px",
              }}
            >
              <strong>Ganador Oficial:</strong>{" "}
              {selectedMatch.winningTeam === 3
                ? "Empate"
                : `Equipo ${selectedMatch.winningTeam}`}
            </div>
          )}

          {!selectedMatch.isResolved ? (
            <div>
              <h3 style={{ marginTop: 0, fontSize: "16px" }}>
                Hacer una apuesta
              </h3>
              <div className="form-group">
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                >
                  <option value="1">
                    Victoria Local (Equipo {selectedMatch.teamA})
                  </option>
                  <option value="2">
                    Victoria Visitante (Equipo {selectedMatch.teamB})
                  </option>
                  <option value="3">Empate</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="ETH a apostar"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                />
                <button onClick={placeBet}>Enviar Apuesta</button>
              </div>
            </div>
          ) : (
            <div>
              <button onClick={claimReward}>🎁 Reclamar Premio</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
