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

const matchesToProcess = matches.slice(0, 10);
const packedMatches = [];

for (const match of matchesToProcess) {
  const apiMatchId = match.id;
  const teamA = match.homeTeam.id;
  const teamB = match.awayTeam.id;
  const startTime = Math.floor(new Date(match.utcDate).getTime() / 1000);

  let packed =
    (BigInt(startTime) << 64n) |
    (BigInt(apiMatchId) << 32n) |
    (BigInt(teamA) << 16n) |
    BigInt(teamB);

  packedMatches.push(packed);
}

let abiEncoded =
  "0000000000000000000000000000000000000000000000000000000000000020";

abiEncoded += packedMatches.length.toString(16).padStart(64, "0");

for (const pack of packedMatches) {
  abiEncoded += pack.toString(16).padStart(64, "0");
}

return Buffer.from(abiEncoded, "hex");
