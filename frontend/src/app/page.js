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
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [betAmount, setBetAmount] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("1"); // 1: Local, 2: Visitante, 3: Empate

  const [activeTab, setActiveTab] = useState("all");

  const formatDateString = (date) => {
    const d = date.getDate().toString().padStart(2, "0");
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  };

  const toInputFormat = (dateStr) => {
    if (!dateStr || dateStr === "all") return "";
    const [d, m, y] = dateStr.split("/");
    return `${y}-${m}-${d}`;
  };

  const fromInputFormat = (dateStr) => {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const parseDateString = (dateStr) => {
    const [d, m, y] = dateStr.split("/");
    return new Date(y, m - 1, d).getTime();
  };

  const [selectedDateFilter, setSelectedDateFilter] = useState(() =>
    formatDateString(new Date()),
  );

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
      if (!rawProvider) {
        setErrorMessage("Por favor, instala y conecta MetaMask.");
        return;
      }
      if (!CONTRACT_ADDRESS) {
        console.error(
          "Falta NEXT_PUBLIC_CONTRACT_ADDRESS en frontend/.env.local",
        );
        setErrorMessage("La dirección del contrato no está configurada.");
        return;
      }
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

  const todayStr = formatDateString(new Date());
  const todayTime = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

  let allDates = [
    ...new Set(
      matches.map((match) =>
        formatDateString(new Date(match.startTime * 1000)),
      ),
    ),
  ];

  if (!allDates.includes(todayStr)) allDates.push(todayStr);
  if (selectedDateFilter !== "all" && !allDates.includes(selectedDateFilter)) {
    allDates.push(selectedDateFilter);
  }

  allDates.sort((a, b) => parseDateString(a) - parseDateString(b));

  const referenceTime =
    selectedDateFilter === "all"
      ? todayTime
      : parseDateString(selectedDateFilter);

  const futureOrToday = allDates.filter(
    (d) => parseDateString(d) >= referenceTime,
  );
  const past = allDates.filter((d) => parseDateString(d) < referenceTime);

  let navDates = futureOrToday.slice(0, 5);

  if (navDates.length < 5 && past.length > 0) {
    const needed = 5 - navDates.length;
    const pastToInclude = past.slice(-needed);
    navDates = [...pastToInclude, ...navDates].sort(
      (a, b) => parseDateString(a) - parseDateString(b),
    );
  }

  let filteredMatches = matches;

  if (activeTab === "my-bets") {
    filteredMatches = filteredMatches.filter((match) => match.userBet !== null);
  }

  if (selectedDateFilter !== "all") {
    filteredMatches = filteredMatches.filter((match) => {
      const matchDateStr = formatDateString(new Date(match.startTime * 1000));
      return matchDateStr === selectedDateFilter;
    });
  }

  const totalMyBets = matches.filter((match) => match.userBet !== null).length;

  return (
    <>
      <header className="top-nav">
        <div className="container top-nav-inner">
          <div className="brand">
            <span className="stripe stripe-mini" aria-hidden="true" />
            DBet
          </div>
          {!account ? (
            <button className="btn btn-sm" onClick={configureBlockchain}>
              Conectar MetaMask
            </button>
          ) : (
            <div className="wallet-badge">
              <span className="wallet-dot" aria-hidden="true" />
              {account.substring(0, 6)}...{account.substring(38)}
            </div>
          )}
        </div>
      </header>

      {errorMessage && (
        <div className="modal-backdrop" role="alertdialog" aria-modal="true">
          <div className="modal">
            <div className="modal-stripe" />
            <div className="modal-body">
              <span className="label-uppercase modal-eyebrow">Error</span>
              <h3 className="modal-title">Algo ha fallado</h3>
              <p className="modal-text">{errorMessage}</p>
              <button
                className="btn btn-solid btn-block"
                onClick={() => setErrorMessage("")}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="container">
        <section className="hero">
          <p className="label-uppercase hero-eyebrow">
            Apuestas de fútbol · Sepolia
          </p>
          <h1 className="hero-title">Apuesta. Sin intermediarios.</h1>
          <p className="hero-lead">
            Elige partido, pronostica el resultado y deja que el contrato
            liquide. Resultados verificados por oráculo, premios directos a tu
            wallet.
          </p>
        </section>

        <div className="stripe" aria-hidden="true" />

        <section className="board">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "all"}
              className={`tab label-uppercase ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              Cartelera
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "my-bets"}
              className={`tab label-uppercase ${activeTab === "my-bets" ? "active" : ""}`}
              disabled={!account}
              onClick={() => {
                if (account) setActiveTab("my-bets");
              }}
            >
              Mis Apuestas
              <span className="tab-count">{totalMyBets}</span>
            </button>
          </div>

          {matches.length > 0 && (
            <div className="date-nav">
              <button
                className={`date-chip ${selectedDateFilter === "all" ? "active" : ""}`}
                onClick={() => setSelectedDateFilter("all")}
              >
                Todos
              </button>

              {navDates.map((dateStr, index) => (
                <button
                  key={index}
                  className={`date-chip ${selectedDateFilter === dateStr ? "active" : ""}`}
                  onClick={() => setSelectedDateFilter(dateStr)}
                >
                  {dateStr === todayStr ? "Hoy" : dateStr}
                </button>
              ))}

              <div className="date-picker">
                <input
                  type="date"
                  className="text-input compact"
                  aria-label="Elegir fecha"
                  value={
                    selectedDateFilter !== "all"
                      ? toInputFormat(selectedDateFilter)
                      : ""
                  }
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDateFilter(fromInputFormat(e.target.value));
                    }
                  }}
                />
              </div>
            </div>
          )}

          {filteredMatches.length === 0 ? (
            <p className="empty-state">
              {activeTab === "my-bets"
                ? "No tienes ninguna apuesta registrada para los filtros seleccionados."
                : `No hay partidos disponibles para el día ${selectedDateFilter === "all" ? "seleccionado" : selectedDateFilter}.`}
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

                const isThisCardSelected = selectedMatch?.id === match.id;

                const pickOptions = [
                  { value: "1", key: "Local", label: infoA.name },
                  { value: "3", key: "Empate", label: "X" },
                  { value: "2", key: "Visitante", label: infoB.name },
                ];

                const canClaim =
                  match.userBet &&
                  match.userBet.selectedTeam === match.winningTeam &&
                  !match.userBet.hasClaimed;

                return (
                  <li
                    key={match.id}
                    className={`match-item ${isThisCardSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (isThisCardSelected) {
                        setSelectedMatch(null);
                      } else {
                        setSelectedMatch(match);
                      }
                    }}
                  >
                    <div className="match-summary">
                      <div className="match-meta">
                        <div className="match-meta-left">
                          <span className="match-time">{timeString}</span>
                          <span className="caption">#{match.id}</span>
                        </div>
                        <div className="match-badges">
                          {match.userBet && (
                            <span className="badge badge-bet">Apostado</span>
                          )}
                          <span className={`badge ${statusClass}`}>
                            {statusText}
                          </span>
                        </div>
                      </div>

                      <div className="match-teams">
                        <div className="team home">
                          <span className="team-name">{infoA.name}</span>
                          {infoA.crest && (
                            <img
                              className="team-crest"
                              src={infoA.crest}
                              alt={infoA.name}
                              width="36"
                              height="36"
                              onError={handleCrestError}
                            />
                          )}
                        </div>

                        <div className="versus">VS</div>

                        <div className="team away">
                          {infoB.crest && (
                            <img
                              className="team-crest"
                              src={infoB.crest}
                              alt={infoB.name}
                              width="36"
                              height="36"
                              onError={handleCrestError}
                            />
                          )}
                          <span className="team-name">{infoB.name}</span>
                        </div>
                      </div>
                    </div>

                    {isThisCardSelected && (
                      <div
                        className="bet-panel"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {match.userBet && (
                          <div className="callout">
                            <span className="label-uppercase">
                              Tu apuesta registrada
                            </span>
                            Has apostado{" "}
                            <strong>{match.userBet.amount} ETH</strong> al
                            pronóstico de{" "}
                            <strong>
                              {match.userBet.selectedTeam === 1 && infoA.name}
                              {match.userBet.selectedTeam === 2 && infoB.name}
                              {match.userBet.selectedTeam === 3 && "Empate (X)"}
                            </strong>
                            .
                            {match.userBet.hasClaimed && (
                              <span className="caption callout-note">
                                El premio de esta apuesta ya ha sido retirado.
                              </span>
                            )}
                          </div>
                        )}

                        {match.isResolved && match.winningTeam !== 0 && (
                          <div className="result-cell">
                            <span className="result-value">
                              {match.winningTeam === 3
                                ? "Empate"
                                : match.winningTeam === 1
                                  ? infoA.name
                                  : infoB.name}
                            </span>
                            <span className="label-uppercase caption">
                              Resultado oficial
                            </span>
                          </div>
                        )}

                        {!match.isResolved ? (
                          <>
                            <div>
                              <p className="label-uppercase step-label">
                                <span className="step-index">01</span>
                                Selecciona tu pronóstico
                              </p>
                              <div className="pick-grid" role="radiogroup">
                                {pickOptions.map((option) => (
                                  <label
                                    key={option.value}
                                    className={`pick ${selectedTeam === option.value ? "active" : ""}`}
                                  >
                                    <input
                                      type="radio"
                                      name="betSelection"
                                      value={option.value}
                                      checked={selectedTeam === option.value}
                                      onChange={(e) =>
                                        setSelectedTeam(e.target.value)
                                      }
                                    />
                                    <span className="label-uppercase pick-key">
                                      {option.key}
                                    </span>
                                    <span className="pick-value">
                                      {option.label}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor={`bet-amount-${match.id}`}
                                className="label-uppercase step-label"
                              >
                                <span className="step-index">02</span>
                                Importe a apostar
                              </label>
                              <div className="amount-field">
                                <input
                                  id={`bet-amount-${match.id}`}
                                  className="text-input"
                                  type="number"
                                  step="0.001"
                                  min="0.01"
                                  inputMode="decimal"
                                  placeholder="0.05"
                                  value={betAmount}
                                  onChange={(e) => setBetAmount(e.target.value)}
                                />
                                <span className="label-uppercase amount-unit">
                                  ETH
                                </span>
                              </div>
                            </div>

                            <button
                              className="btn btn-solid btn-block"
                              onClick={placeBet}
                              disabled={!betAmount || Number(betAmount) <= 0}
                            >
                              Confirmar Apuesta
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="claim-text">
                              {canClaim
                                ? "¡Has ganado la apuesta! Haz clic abajo para retirar tus fondos."
                                : "El partido ha finalizado. Comprueba si has ganado."}
                            </p>
                            <button
                              className="btn btn-solid btn-block"
                              onClick={claimReward}
                              disabled={!canClaim}
                            >
                              {match.userBet?.hasClaimed
                                ? "Premio ya Retirado"
                                : "Reclamar Premio"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span className="brand">
            <span className="stripe stripe-mini" aria-hidden="true" />
            DBet
          </span>
          <span className="caption">
            Apuestas descentralizadas en Ethereum Sepolia. Juega con
            responsabilidad.
          </span>
        </div>
      </footer>
    </>
  );
}
