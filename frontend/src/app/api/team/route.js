import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Falta el ID del equipo" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `https://api.football-data.org/v4/teams/${id}`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY,
        },
        next: { revalidate: 3600 },
      },
    );

    if (!response.ok) {
      throw new Error(`Error de la API externa: ${response.status}`);
    }

    const data = await response.json();

    const filteredTeam = {
      name: data.name || `Equipo ${id}`,
      crest: data.crest || null,
    };

    return NextResponse.json(filteredTeam);
  } catch (error) {
    console.error(`Error al obtener el equipo ${id}:`, error.message);

    return NextResponse.json({
      name: `Equipo ${id}`,
      crest: null,
    });
  }
}
