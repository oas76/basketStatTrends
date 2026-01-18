const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const uploadDetails = document.getElementById("uploadDetails");
const gamesTable = document.getElementById("gamesTable");
const clearData = document.getElementById("clearData");

const renderGames = () => {
  const { games } = window.basketStatData.loadData();
  if (games.length === 0) {
    gamesTable.innerHTML = `
      <tr>
        <td colspan="5">No games uploaded yet.</td>
      </tr>
    `;
    return;
  }

  gamesTable.innerHTML = games
    .map(
      (game) => `
        <tr>
          <td>${new Date(game.date).toLocaleDateString()}</td>
          <td>${game.opponent}</td>
          <td>${game.league || "-"}</td>
          <td>${game.homeAway === "home" ? "Home" : game.homeAway === "away" ? "Away" : "-"}</td>
          <td>${game.entries.map((entry) => entry.name).join(", ")}</td>
        </tr>
      `
    )
    .join("");
};

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const date = document.getElementById("gameDate").value;
  const opponent = document.getElementById("opponent").value.trim();
  const league = document.getElementById("league").value.trim();
  const homeAway = document.getElementById("homeAway").value;
  const file = document.getElementById("csvFile").files[0];

  if (!date || !opponent || !league || !homeAway || !file) {
    uploadStatus.textContent = "Missing data";
    uploadDetails.textContent = "Please provide date, opponent, league, home/away, and CSV file.";
    return;
  }

  try {
    const { entries } = await window.basketStatData.parseCsv(file);
    const data = window.basketStatData.loadData();
    data.games.push({ date, opponent, league, homeAway, entries });
    data.games.sort((a, b) => new Date(a.date) - new Date(b.date));
    window.basketStatData.saveData(data);

    uploadStatus.textContent = "Upload complete";
    uploadDetails.textContent = `Added ${entries.length} players for ${opponent} (${league}, ${homeAway === "home" ? "Home" : "Away"}).`;
    uploadForm.reset();
    renderGames();
  } catch (error) {
    uploadStatus.textContent = "Upload failed";
    uploadDetails.textContent = error.message;
  }
});

clearData.addEventListener("click", () => {
  if (window.confirm("Clear all stored games?")) {
    window.basketStatData.saveData({ games: [] });
    renderGames();
    uploadStatus.textContent = "Data cleared";
    uploadDetails.textContent = "All stored games have been removed.";
  }
});

renderGames();
