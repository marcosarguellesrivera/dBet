"use client";
import { useState, useEffect, useRef } from 'react';
import { Contract, ethers, BrowserProvider } from "ethers";
import { decodeError } from "@ubiquity-os/ethers-decode-error"; 

import DBetManifest from "../contracts/dBet.json";

const CONTRACT_ADDRESS = "direccion"; 

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
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
      
      const signer = await provider.getSigner();
      signerRef.current = signer;
      
      contractRef.current = new Contract(CONTRACT_ADDRESS, DBetManifest.abi, signer);
      
      await fetchMatches();
    } catch (error) {
      console.error("Error conectando MetaMask:", error);
      setErrorMessage("Por favor, instala y conecta MetaMask.");
    }
  }

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
          startTime: Number(matchData.startTime)
        });
      }
      setMatches(loadedMatches);
    } catch (error) {
      let decoded = decodeError(error);
      setErrorMessage(decoded.error | "Error al obtener partidos");
    }
  }

  const createMatch = async () => {
    try {
      setErrorMessage("");
      const startTimeUnix = Math.floor(new Date(matchDate).getTime() / 1000);
      
      const tx = await contractRef.current.createMatch(parseInt(teamA), parseInt(teamB), startTimeUnix);
      await tx.wait();
      
      setTeamA("");
      setTeamB("");
      setMatchDate("");
      await fetchMatches();
    } catch (error) {
      let decoded = decodeError(error);
      console.error(decoded.error);
      setErrorMessage(decoded.error | "Error al crear el partido");
    }
  }

  const placeBet = async () => {
    if (!selectedMatch) return;
    try {
      setErrorMessage("");
      const parsedAmount = ethers.parseEther(betAmount.toString());
      
      const tx = await contractRef.current.bet(selectedMatch.id, parseInt(selectedTeam), {
        value: parsedAmount
      });
      await tx.wait();
      
      setBetAmount("");
      alert("¡Apuesta realizada con éxito!");
    } catch (error) {
      let decoded = decodeError(error)
      setErrorMessage(decoded.error | "Error al realizar la apuesta");
    }
  }

  const claimReward = async () => {
    if (!selectedMatch) return;
    try {
      setErrorMessage("");
      const tx = await contractRef.current.claimReward(selectedMatch.id);
      await tx.wait();
      alert("¡Premio reclamado!");
    } catch (error) {
      let decoded = decodeError(error);
      setErrorMessage(decoded.error | "Error al reclamar las ganancias");
    }
  }

  return (
    <div className="container" style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      {!account ? (
        <button onClick={configureBlockchain}>Conectar MetaMask</button>
      ) : (
        <p>Wallet Conectada: {account.substring(0,6)}...{account.substring(38)}</p>
      )}

      {errorMessage && <div style={{ color: 'red', margin: '10px 0' }}>{errorMessage}</div>}

      <div className="card" style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px' }}>
        <h2>Crear Nuevo Partido (Solo Admin)</h2>
        <div>
          <input type="number" placeholder="ID Equipo Local" value={teamA} onChange={e => setTeamA(e.target.value)} />
          <input type="number" placeholder="ID Equipo Visitante" value={teamB} onChange={e => setTeamB(e.target.value)} />
          <input type="datetime-local" value={matchDate} onChange={e => setMatchDate(e.target.value)} />
          <button onClick={createMatch}>Programar Partido</button>
        </div>
      </div>

      <div className="card" style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px' }}>
        <h2>Partidos Disponibles</h2>
        {matches.length === 0 ? <p>No hay partidos activos.</p> : (
          <ul>
            {matches.map((match) => (
              <li key={match.id} style={{ cursor: "pointer", color: "blue", margin: '10px 0' }} onClick={() => setSelectedMatch(match)}>
                Partido #{match.id}: Equipo {match.teamA} vs Equipo {match.teamB} 
                {match.isResolved ? " (Finalizado)" : " (Abierto)"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedMatch && (
        <div className="card" style={{ border: '1px solid #ccc', padding: '15px' }}>
          <h2>Detalles del Partido #{selectedMatch.id}</h2>
          <p><strong>Inicio:</strong> {new Date(selectedMatch.startTime * 1000).toLocaleString()}</p>
          <p><strong>Estado:</strong> {selectedMatch.isResolved ? "Finalizado" : "Pendiente"}</p>
          
          {selectedMatch.isResolved && selectedMatch.winningTeam !== 0 && (
            <p><strong>Ganador:</strong> {selectedMatch.winningTeam === 3 ? "Empate" : `Equipo ${selectedMatch.winningTeam}`}</p>
          )}

          {!selectedMatch.isResolved ? (
            <div style={{ marginTop: '15px' }}>
              <h3>Hacer una apuesta</h3>
              <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} style={{ marginRight: '10px' }}>
                <option value="1">Victoria Local (Equipo {selectedMatch.teamA})</option>
                <option value="2">Victoria Visitante (Equipo {selectedMatch.teamB})</option>
                <option value="3">Empate</option>
              </select>
              <input type="number" step="0.01" min="0.01" placeholder="ETH a apostar" value={betAmount} onChange={e => setBetAmount(e.target.value)} />
              <button onClick={placeBet}>Pujar</button>
            </div>
          ) : (
            <div style={{ marginTop: '15px' }}>
              <button onClick={claimReward}>Reclamar Premio</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}