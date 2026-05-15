const apiKey = "__API_KEY__";

const apiRequest = Functions.makeHttpRequest({
  url: "https://api.football-data.org/v4/matches?status=SCHEDULED",
  method: "GET",
  headers: {
    "X-Auth-Token": apiKey,
  },
});

const apiResponse = await apiRequest;

if (apiResponse.error) {
  console.error("Error in the API:", apiResponse.error);
  throw Error("Failure to connect with the API");
}

const matches = apiResponse.data.matches;

if (!matches || matches.length === 0) {
  throw Error("No matches scheduled");
}

const match = matches[0];

const teamA = match.homeTeam.id;
const teamB = match.awayTeam.id;
const startTime = Math.floor(new Date(match.utcDate).getTime() / 1000);

let packed =
  (BigInt(startTime) << 32n) | (BigInt(teamA) << 16n) | BigInt(teamB);

return Functions.encodeUint256(packed);
