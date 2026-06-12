"use client";
import { useState, useEffect, useRef } from "react";
import { Contract, ethers } from "ethers";
import detectEthereumProvider from "@metamask/detect-provider";
import { decodeError } from "@ubiquity-os/ethers-decode-error";
import DBetManifest from "../contracts/DBet.json";
import { getLocalTeamInfo } from "../utils/teamMapper";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

export default function Home() {
  const contractRef = useRef(null);
  const signerRef = useRef(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [account, setAccount] = useState("");
  const [matches, setMatches] = useState([]);
  const [fetchedTeams, setFetchedTeams] = useState({});
  const [userBetInfo, setUserBetInfo] = useState(null);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [betAmount, setBetAmount] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("1"); // 1: Local, 2: Visitante, 3: Empate

  const [selectedDateFilter, setSelectedDateFilter] = useState("all");

  useEffect(() => {
    if (window.ethereum) {
      configureBlockchain();
    }
  }, []);

  useEffect(() => {
    if (matches.length > 0) {
      resolveMissingTeams();
    }
  }, [matches]);

  useEffect(() => {
    if (selectedMatch && account) {
      fetchUserBetOnMatch();
    } else {
      setUserBetInfo(null);
    }
  }, [selectedMatch, account]);

  const resolveMissingTeams = async () => {
    const newTeamsCache = { ...fetchedTeams };
    let updated = false;

    for (const match of matches) {
      const teamsToCheck = [match.teamA, match.teamB];

      for (const teamId of teamsToCheck) {
        if (getLocalTeamInfo(teamId)) continue;
        if (newTeamsCache[teamId]) continue;

        try {
          const res = await fetch(`/api/team?id=${teamId}`);
          if (res.ok) {
            const data = await res.json();
            newTeamsCache[teamId] = data;
            updated = true;
          }
        } catch (err) {
          console.error("Error al obtener equipo de la API:", err);
        }
      }
    }

    if (updated) {
      setFetchedTeams(newTeamsCache);
    }
  };

  const displayTeam = (id) => {
    const localTeam = getLocalTeamInfo(id);
    if (localTeam) return localTeam;
    if (fetchedTeams[id]) return fetchedTeams[id];
    return { name: `Equipo ${id}`, crest: null };
  };

  const handleCrestError = (e) => {
    e.target.style.display = "none";
  };

  const configureBlockchain = async () => {
    try {
      const rawProvider = await detectEthereumProvider();
      try {
        const sepoliaChainId = "0xaa36a7";
        await rawProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: sepoliaChainId }],
        });
      } catch (switchError) {
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

  const fetchUserBetOnMatch = async () => {
    if (!contractRef.current || !selectedMatch || !account) return;

    try {
      const betData = await contractRef.current.userBets(
        selectedMatch.id,
        account,
      );

      setUserBetInfo({
        amount: ethers.utils.formatEther(betData.amount),
        selectedTeam: Number(betData.selectedTeam),
        hasClaimed: betData.hasClaimed,
      });
    } catch (error) {
      console.error("Error al obtener la apuesta del usuario:", error);
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
        0,
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
        { value: parsedAmount },
      );
      await tx.wait();
      setBetAmount("");
      await fetchUserBetOnMatch();
    } catch (error) {
      if (error?.message?.includes("insufficient funds")) {
        setErrorMessage("Saldo insuficiente en tu wallet.");
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

  const uniqueDates = [
    ...new Set(
      matches.map((match) => {
        const dateObj = new Date(match.startTime * 1000);
        return dateObj.toLocaleDateString();
      }),
    ),
  ].sort((a, b) => {
    const [dayA, monthA, yearA] = a.split("/");
    const [dayB, monthB, yearB] = b.split("/");
    return (
      new Date(`${yearA}-${monthA}-${dayA}`) -
      new Date(`${yearB}-${monthB}-${dayB}`)
    );
  });

  const filteredMatches =
    selectedDateFilter === "all"
      ? matches
      : matches.filter((match) => {
          const matchDateStr = new Date(
            match.startTime * 1000,
          ).toLocaleDateString();
          return matchDateStr === selectedDateFilter;
        });

  return (
    <div className="container">
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
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary, #1e1e2f)",
              border: "1px solid #ef4444",
              borderRadius: "12px",
              padding: "25px",
              maxWidth: "400px",
              width: "90%",
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              textAlign: "center",
              animation: "fadeIn 0.2s ease-out",
            }}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>⚠️</div>
            <h3
              style={{ color: "#ef4444", marginTop: 0, marginBottom: "15px" }}
            >
              Algo ha fallado
            </h3>

            <p
              style={{
                color: "var(--text-color, #fff)",
                lineHeight: "1.5",
                marginBottom: "20px",
              }}
            >
              {errorMessage}
            </p>

            <button
              onClick={() => setErrorMessage("")}
              style={{
                padding: "12px 20px",
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
                width: "100%",
                fontSize: "1rem",
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Crear Nuevo Partido</h2>
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ margin: 0 }}>Cartelera de Partidos</h2>
        </div>

        {matches.length > 0 && (
          <div
            className="date-nav-bar"
            style={{
              display: "flex",
              gap: "10px",
              overflowX: "auto",
              paddingBottom: "10px",
              marginBottom: "15px",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <button
              className={`nav-btn ${selectedDateFilter === "all" ? "active" : ""}`}
              onClick={() => setSelectedDateFilter("all")}
              style={{
                padding: "8px 16px",
                borderRadius: "20px",
                border: "none",
                cursor: "pointer",
                backgroundColor:
                  selectedDateFilter === "all"
                    ? "var(--primary)"
                    : "var(--bg-secondary)",
                color:
                  selectedDateFilter === "all" ? "#fff" : "var(--text-color)",
                whiteSpace: "nowrap",
              }}
            >
              Todos
            </button>
            {uniqueDates.map((dateStr, index) => (
              <button
                key={index}
                className={`nav-btn ${selectedDateFilter === dateStr ? "active" : ""}`}
                onClick={() => setSelectedDateFilter(dateStr)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "20px",
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    selectedDateFilter === dateStr
                      ? "var(--primary)"
                      : "var(--bg-secondary)",
                  color:
                    selectedDateFilter === dateStr
                      ? "#fff"
                      : "var(--text-color)",
                  whiteSpace: "nowrap",
                }}
              >
                {dateStr}
              </button>
            ))}
          </div>
        )}

        {filteredMatches.length === 0 ? (
          <p
            style={{
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "20px",
            }}
          >
            No hay partidos programados para este día.
          </p>
        ) : (
          <ul className="match-list">
            {filteredMatches.map((match) => {
              const currentTime = Math.floor(Date.now() / 1000);
              const hasStarted = currentTime >= match.startTime;

              let statusText = "Abierto";
              let statusClass = "status-open";

              if (match.isResolved) {
                statusText = "Finalizado";
                statusClass = "status-resolved";
              } else if (hasStarted) {
                statusText = "En juego";
                statusClass = "status-playing";
              }

              const infoA = displayTeam(match.teamA);
              const infoB = displayTeam(match.teamB);
              const timeString = new Date(
                match.startTime * 1000,
              ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

              return (
                <li
                  key={match.id}
                  className="match-item"
                  onClick={() => setSelectedMatch(match)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.85rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      <span>
                        #{match.id} | 🕒 {timeString}
                      </span>
                      <span className={`match-status ${statusClass}`}>
                        {statusText}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "15px",
                        padding: "10px 0",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flex: 1,
                          justifyContent: "flex-end",
                        }}
                      >
                        <span style={{ fontWeight: "bold" }}>{infoA.name}</span>
                        {infoA.crest && (
                          <img
                            src={infoA.crest}
                            alt={infoA.name}
                            width="28"
                            height="28"
                            style={{ objectFit: "contain" }}
                            onError={handleCrestError}
                          />
                        )}
                      </div>

                      <div
                        style={{
                          color: "var(--text-muted)",
                          fontWeight: "bold",
                          fontSize: "0.9rem",
                        }}
                      >
                        VS
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flex: 1,
                          justifyContent: "flex-start",
                        }}
                      >
                        {infoB.crest && (
                          <img
                            src={infoB.crest}
                            alt={infoB.name}
                            width="28"
                            height="28"
                            style={{ objectFit: "contain" }}
                            onError={handleCrestError}
                          />
                        )}
                        <span style={{ fontWeight: "bold" }}>{infoB.name}</span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedMatch && (
        <div
          className="card"
          style={{ border: "2px solid var(--primary)", position: "relative" }}
        >
          <button
            onClick={() => setSelectedMatch(null)}
            style={{
              position: "absolute",
              top: "15px",
              right: "15px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.2rem",
            }}
          >
            ✕
          </button>

          <h2 style={{ marginTop: 0, marginBottom: "5px" }}>
            Boleta de Apuesta
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              marginBottom: "25px",
              fontSize: "0.9rem",
            }}
          >
            {displayTeam(selectedMatch.teamA).name} vs{" "}
            {displayTeam(selectedMatch.teamB).name}
          </p>

          {userBetInfo && Number(userBetInfo.amount) > 0 && (
            <div
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgb(16, 185, 129)",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "20px",
                fontSize: "0.95rem",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontWeight: "bold",
                  color: "rgb(16, 185, 129)",
                  marginBottom: "4px",
                }}
              >
                Tu apuesta registrada:
              </span>
              Has apostado{" "}
              <strong style={{ fontSize: "1.05rem" }}>
                {userBetInfo.amount} ETH
              </strong>{" "}
              al pronóstico de{" "}
              <strong style={{ color: "var(--primary)" }}>
                {userBetInfo.selectedTeam === 1 &&
                  displayTeam(selectedMatch.teamA).name}
                {userBetInfo.selectedTeam === 2 &&
                  displayTeam(selectedMatch.teamB).name}
                {userBetInfo.selectedTeam === 3 && "Empate (X)"}
              </strong>
              .
              {userBetInfo.hasClaimed && (
                <span
                  style={{
                    display: "block",
                    marginTop: "5px",
                    color: "var(--text-muted)",
                    fontSize: "0.85rem",
                  }}
                >
                  El premio de esta apuesta ya ha sido retirado.
                </span>
              )}
            </div>
          )}

          {selectedMatch.isResolved && selectedMatch.winningTeam !== 0 && (
            <div
              style={{
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                padding: "15px",
                borderRadius: "8px",
                marginBottom: "20px",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: "0.9rem",
                  color: "var(--text-muted)",
                  marginBottom: "5px",
                }}
              >
                Resultado Oficial:
              </span>
              <strong style={{ fontSize: "1.1rem", color: "var(--primary)" }}>
                {selectedMatch.winningTeam === 3
                  ? "Empate"
                  : selectedMatch.winningTeam === 1
                    ? displayTeam(selectedMatch.teamA).name
                    : displayTeam(selectedMatch.teamB).name}
              </strong>
            </div>
          )}

          {!selectedMatch.isResolved ? (
            <div>
              <div style={{ marginBottom: "20px" }}>
                <p style={{ fontWeight: "bold", marginBottom: "10px" }}>
                  1. Selecciona tu pronóstico:
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "10px",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "15px 10px",
                      border:
                        selectedTeam === "1"
                          ? "2px solid var(--primary)"
                          : "1px solid var(--border-color)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        selectedTeam === "1"
                          ? "rgba(59, 130, 246, 0.1)"
                          : "transparent",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="betSelection"
                      value="1"
                      checked={selectedTeam === "1"}
                      onChange={(e) => setSelectedTeam(e.target.value)}
                      style={{ display: "none" }}
                    />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "5px",
                      }}
                    >
                      Local
                    </span>
                    <span style={{ fontWeight: "bold", textAlign: "center" }}>
                      {displayTeam(selectedMatch.teamA).name}
                    </span>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "15px 10px",
                      border:
                        selectedTeam === "3"
                          ? "2px solid var(--primary)"
                          : "1px solid var(--border-color)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        selectedTeam === "3"
                          ? "rgba(59, 130, 246, 0.1)"
                          : "transparent",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="betSelection"
                      value="3"
                      checked={selectedTeam === "3"}
                      onChange={(e) => setSelectedTeam(e.target.value)}
                      style={{ display: "none" }}
                    />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "5px",
                      }}
                    >
                      Empate
                    </span>
                    <span style={{ fontWeight: "bold", textAlign: "center" }}>
                      X
                    </span>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "15px 10px",
                      border:
                        selectedTeam === "2"
                          ? "2px solid var(--primary)"
                          : "1px solid var(--border-color)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        selectedTeam === "2"
                          ? "rgba(59, 130, 246, 0.1)"
                          : "transparent",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <input
                      type="radio"
                      name="betSelection"
                      value="2"
                      checked={selectedTeam === "2"}
                      onChange={(e) => setSelectedTeam(e.target.value)}
                      style={{ display: "none" }}
                    />
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "5px",
                      }}
                    >
                      Visitante
                    </span>
                    <span style={{ fontWeight: "bold", textAlign: "center" }}>
                      {displayTeam(selectedMatch.teamB).name}
                    </span>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <p style={{ fontWeight: "bold", marginBottom: "10px" }}>
                  2. Importe a apostar (ETH):
                </p>
                <input
                  type="number"
                  step="0.001"
                  min="0.01"
                  placeholder="Ej: 0.05"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-color)",
                  }}
                />
              </div>

              <button
                onClick={placeBet}
                disabled={!betAmount || Number(betAmount) <= 0}
                style={{
                  width: "100%",
                  padding: "15px",
                  fontSize: "1.1rem",
                  opacity: !betAmount || Number(betAmount) <= 0 ? 0.5 : 1,
                }}
              >
                Confirmar Apuesta
              </button>
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <p style={{ marginBottom: "20px" }}>
                El partido ha finalizado. Comprueba si has ganado.
              </p>
              <button onClick={claimReward} style={{ width: "100%" }}>
                Reclamar Premio
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
