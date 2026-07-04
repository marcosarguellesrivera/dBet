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
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [betAmount, setBetAmount] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("1"); // 1: Local, 2: Visitante, 3: Empate

  const [selectedDateFilter, setSelectedDateFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");

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
    if (selectedMatch) {
      const currentMatchData = matches.find((m) => m.id === selectedMatch.id);
      if (currentMatchData?.userBet) {
        setSelectedTeam(currentMatchData.userBet.selectedTeam.toString());
      } else {
        setSelectedTeam("1");
      }
    }
  }, [selectedMatch, matches]);

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

      await fetchMatches(accounts[0]);
    } catch (error) {
      console.error("Error conectando MetaMask:", error);
      setErrorMessage("Por favor, instala y conecta MetaMask.");
    }
  };

  const fetchMatches = async (userAccount = account) => {
    try {
      if (!contractRef.current) return;
      const counter = await contractRef.current.matchCounter();
      const totalMatches = Number(counter);

      let loadedMatches = [];
      for (let i = 1; i <= totalMatches; i++) {
        const matchData = await contractRef.current.matches(i);

        let userBet = null;
        if (userAccount) {
          const betData = await contractRef.current.userBets(i, userAccount);
          if (betData.amount.gt(0)) {
            userBet = {
              amount: ethers.utils.formatEther(betData.amount),
              selectedTeam: Number(betData.selectedTeam),
              hasClaimed: betData.hasClaimed,
            };
          }
        }

        loadedMatches.push({
          id: i,
          teamA: Number(matchData.teamA),
          teamB: Number(matchData.teamB),
          isResolved: matchData.isResolved,
          winningTeam: Number(matchData.winningTeam),
          startTime: Number(matchData.startTime),
          userBet: userBet,
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
      await fetchMatches();
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
      await fetchMatches();
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

  let filteredMatches = matches;

  if (activeTab === "my-bets") {
    filteredMatches = filteredMatches.filter((match) => match.userBet !== null);
  }

  if (selectedDateFilter !== "all") {
    filteredMatches = filteredMatches.filter((match) => {
      const matchDateStr = new Date(
        match.startTime * 1000,
      ).toLocaleDateString();
      return matchDateStr === selectedDateFilter;
    });
  }

  const totalMyBets = matches.filter((match) => match.userBet !== null).length;

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
            borderBottom: "2px solid #2a2a40",
            paddingBottom: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "20px" }}>
            <h2
              onClick={() => setActiveTab("all")}
              style={{
                margin: 0,
                cursor: "pointer",
                color: activeTab === "all" ? "var(--primary, #3b82f6)" : "#888",
                borderBottom:
                  activeTab === "all" ? "3px solid var(--primary)" : "none",
                paddingBottom: "5px",
              }}
            >
              Cartelera
            </h2>
            <h2
              onClick={() => {
                if (account) setActiveTab("my-bets");
              }}
              style={{
                margin: 0,
                cursor: account ? "pointer" : "not-allowed",
                color:
                  activeTab === "my-bets" ? "var(--primary, #3b82f6)" : "#888",
                borderBottom:
                  activeTab === "my-bets" ? "3px solid var(--primary)" : "none",
                paddingBottom: "5px",
                opacity: account ? 1 : 0.4,
              }}
            >
              Mis Apuestas ({totalMyBets})
            </h2>
          </div>
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
                    ? "var(--primary, #3b82f6)"
                    : "var(--bg-secondary, #24243e)",
                color:
                  selectedDateFilter === "all"
                    ? "#fff"
                    : "var(--text-color, #fff)",
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
                      ? "var(--primary, #3b82f6)"
                      : "var(--bg-secondary, #24243e)",
                  color:
                    selectedDateFilter === dateStr
                      ? "#fff"
                      : "var(--text-color, #fff)",
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
              color: "var(--text-muted, #888)",
              textAlign: "center",
              padding: "20px",
            }}
          >
            {activeTab === "my-bets"
              ? "No tienes ninguna apuesta registrada para los filtros seleccionados."
              : "No hay partidos programados para este día."}
          </p>
        ) : (
          <ul className="match-list" style={{ listStyle: "none", padding: 0 }}>
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

              const isThisCardSelected = selectedMatch?.id === match.id;

              return (
                <li
                  key={match.id}
                  className={`match-item ${isThisCardSelected ? "selected-inline" : ""}`}
                  onClick={() => {
                    if (isThisCardSelected) {
                      setSelectedMatch(null);
                    } else {
                      setSelectedMatch(match);
                    }
                  }}
                  style={{
                    cursor: "pointer",
                    border: isThisCardSelected
                      ? "2px solid var(--primary, #3b82f6)"
                      : "1px solid var(--border-color, #2a2a40)",
                    borderRadius: "12px",
                    padding: "15px",
                    marginBottom: "12px",
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "var(--card-bg, #1a1a2e)",
                    transition: "all 0.2s ease",
                  }}
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
                        color: "var(--text-muted, #888)",
                      }}
                    >
                      <span>
                        #{match.id} | 🕒 {timeString}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        {match.userBet && (
                          <span
                            style={{
                              backgroundColor: "rgba(16, 185, 129, 0.2)",
                              color: "#10b981",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                            }}
                          >
                            Apostado
                          </span>
                        )}
                        <span className={`match-status ${statusClass}`}>
                          {statusText}
                        </span>
                      </div>
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
                          color: "var(--text-muted, #888)",
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

                  {isThisCardSelected && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: "15px",
                        paddingTop: "15px",
                        borderTop: "1px solid var(--border-color, #3a3a50)",
                        cursor: "default",
                        width: "100%",
                      }}
                    >
                      {match.userBet && (
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
                            {match.userBet.amount} ETH
                          </strong>{" "}
                          al pronóstico de{" "}
                          <strong style={{ color: "var(--primary, #3b82f6)" }}>
                            {match.userBet.selectedTeam === 1 && infoA.name}
                            {match.userBet.selectedTeam === 2 && infoB.name}
                            {match.userBet.selectedTeam === 3 && "Empate (X)"}
                          </strong>
                          .
                          {match.userBet.hasClaimed && (
                            <span
                              style={{
                                display: "block",
                                marginTop: "5px",
                                color: "var(--text-muted, #888)",
                                fontSize: "0.85rem",
                              }}
                            >
                              El premio de esta apuesta ya ha sido retirado.
                            </span>
                          )}
                        </div>
                      )}

                      {match.isResolved && match.winningTeam !== 0 && (
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
                              color: "var(--text-muted, #888)",
                              marginBottom: "5px",
                            }}
                          >
                            Resultado Oficial:
                          </span>
                          <strong
                            style={{
                              fontSize: "1.1rem",
                              color: "var(--primary, #3b82f6)",
                            }}
                          >
                            {match.winningTeam === 3
                              ? "Empate"
                              : match.winningTeam === 1
                                ? infoA.name
                                : infoB.name}
                          </strong>
                        </div>
                      )}

                      {!match.isResolved ? (
                        <div>
                          <div style={{ marginBottom: "20px" }}>
                            <p
                              style={{
                                fontWeight: "bold",
                                marginBottom: "10px",
                              }}
                            >
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
                                      ? "2px solid var(--primary, #3b82f6)"
                                      : "1px solid var(--border-color, #2a2a40)",
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
                                  onChange={(e) =>
                                    setSelectedTeam(e.target.value)
                                  }
                                  style={{ display: "none" }}
                                />
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    color: "var(--text-muted, #888)",
                                    marginBottom: "5px",
                                  }}
                                >
                                  Local
                                </span>
                                <span
                                  style={{
                                    fontWeight: "bold",
                                    textAlign: "center",
                                  }}
                                >
                                  {infoA.name}
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
                                      ? "2px solid var(--primary, #3b82f6)"
                                      : "1px solid var(--border-color, #2a2a40)",
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
                                  onChange={(e) =>
                                    setSelectedTeam(e.target.value)
                                  }
                                  style={{ display: "none" }}
                                />
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    color: "var(--text-muted, #888)",
                                    marginBottom: "5px",
                                  }}
                                >
                                  Empate
                                </span>
                                <span
                                  style={{
                                    fontWeight: "bold",
                                    textAlign: "center",
                                  }}
                                >
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
                                      ? "2px solid var(--primary, #3b82f6)"
                                      : "1px solid var(--border-color, #2a2a40)",
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
                                  onChange={(e) =>
                                    setSelectedTeam(e.target.value)
                                  }
                                  style={{ display: "none" }}
                                />
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    color: "var(--text-muted, #888)",
                                    marginBottom: "5px",
                                  }}
                                >
                                  Visitante
                                </span>
                                <span
                                  style={{
                                    fontWeight: "bold",
                                    textAlign: "center",
                                  }}
                                >
                                  {infoB.name}
                                </span>
                              </label>
                            </div>
                          </div>

                          <div style={{ marginBottom: "20px" }}>
                            <p
                              style={{
                                fontWeight: "bold",
                                marginBottom: "10px",
                              }}
                            >
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
                                border:
                                  "1px solid var(--border-color, #2a2a40)",
                                backgroundColor: "var(--bg-secondary, #24243e)",
                                color: "var(--text-color, #fff)",
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
                              opacity:
                                !betAmount || Number(betAmount) <= 0 ? 0.5 : 1,
                            }}
                          >
                            Confirmar Apuesta
                          </button>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center" }}>
                          <p style={{ marginBottom: "20px" }}>
                            {match.userBet &&
                            match.userBet.selectedTeam === match.winningTeam &&
                            !match.userBet.hasClaimed
                              ? "¡Has ganado la apuesta! Haz clic abajo para retirar tus fondos."
                              : "El partido ha finalizado. Comprueba si has ganado."}
                          </p>
                          <button
                            onClick={claimReward}
                            disabled={
                              !match.userBet ||
                              match.userBet.selectedTeam !==
                                match.winningTeam ||
                              match.userBet.hasClaimed
                            }
                            style={{
                              width: "100%",
                              opacity:
                                !match.userBet ||
                                match.userBet.selectedTeam !==
                                  match.winningTeam ||
                                match.userBet.hasClaimed
                                  ? 0.4
                                  : 1,
                            }}
                          >
                            {match.userBet?.hasClaimed
                              ? "Premio ya Retirado"
                              : "Reclamar Premio"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
