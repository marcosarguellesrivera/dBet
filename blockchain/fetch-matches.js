const apiKey = "__API_KEY__";

if (!apiKey) {
  throw Error(
    "API_KEY secret is missing. Revisa la inyección de secretos en el contrato.",
  );
}

const offset = args.length > 0 ? parseInt(args[0]) : 0;

const today = new Date();
const nextWeek = new Date();
nextWeek.setDate(today.getDate() + 7);

const dateFrom = today.toISOString().split("T")[0];
const dateTo = nextWeek.toISOString().split("T")[0];

const url = `https://api.football-data.org/v4/matches?status=SCHEDULED&dateFrom=${dateFrom}&dateTo=${dateTo}`;

const apiRequest = Functions.makeHttpRequest({
  url: url,
  method: "GET",
  headers: {
    "X-Auth-Token": apiKey,
  },
});

const apiResponse = await apiRequest;

if (apiResponse.error) {
  throw Error("Failure to connect with the API");
}

const matches = apiResponse.data.matches;

if (!matches || matches.length === 0 || offset >= matches.length) {
  const emptyAbi =
    "00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
  const emptyHexArray = emptyAbi.match(/.{1,2}/g);
  return new Uint8Array(emptyHexArray.map((byte) => parseInt(byte, 16)));
}

const matchesToProcess = matches.slice(offset, offset + 3);
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

const hexArray = abiEncoded.match(/.{1,2}/g);
const byteArray = new Uint8Array(hexArray.map((byte) => parseInt(byte, 16)));

return byteArray;
