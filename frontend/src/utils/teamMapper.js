import teamsData from "../data/teams.json";

export const getLocalTeamInfo = (id) => {
  const team = teamsData[id.toString()];
  if (team) {
    return {
      name: team.name,
      crest: team.crest,
    };
  }
  return null;
};
