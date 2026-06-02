console.log("Checking match result...");

const apiMatchId = args[0];
const apiKey = "__API_KEY__";

if (!apiMatchId) {
  throw Error("Missing match id");
}

const apiRequest = Functions.makeHttpRequest({
  url: `https://api.football-data.org/v4/matches/${apiMatchId}`,
  method: "GET",
  headers: { "X-Auth-Token": apiKey },
});

const apiResponse = await apiRequest;

if (apiResponse.error) {
  throw Error("Failiure trying to conect to the API");
}

const match = apiResponse.data;

if (match.status !== "FINISHED") {
  throw Error(`Match not finished. Actual status: ${match.status}`);
}

const homeScore = match.score.fullTime.home;
const awayScore = match.score.fullTime.away;

let winningTeam = 3;

if (homeScore > awayScore) {
  winningTeam = 1;
} else if (awayScore > homeScore) {
  winningTeam = 2;
}

console.log(`Resultado: ${homeScore} - ${awayScore}. Winner: ${winningTeam}`);

return Functions.encodeUint256(winningTeam);
