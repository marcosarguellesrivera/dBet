// Este código se ejecutará en la red de oráculos de Chainlink

// const response = await Functions.makeHttpRequest({ url: "https://api.tu-deporte.com/matches" }); // Llamada a la API

// Datos simulados
const teamA = 1;
const teamB = 2;
const startTime = Math.floor(Date.now() / 1000) + 3600;

const packed =
  (BigInt(startTime) << 16n) | (BigInt(teamA) << 8n) | BigInt(teamB);

return Functions.encodeUint256(packed);
