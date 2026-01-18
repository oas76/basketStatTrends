const STORAGE_KEY = "basketstat-data";

const loadData = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { games: [] };
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse stored data", error);
    return { games: [] };
  }
};

const saveData = (data) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const parseCsv = async (file) => {
  const text = await file.text();
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((item) => item.trim());
  const playerIndex = headers.findIndex((header) => header.toLowerCase() === "player");

  if (playerIndex === -1) {
    throw new Error("CSV must include a 'player' column.");
  }

  const statHeaders = headers.filter((_, index) => index !== playerIndex);
  const entries = rows
    .map((row) => row.split(",").map((item) => item.trim()))
    .filter((row) => row.length === headers.length)
    .map((columns) => {
      const player = columns[playerIndex];
      const stats = {};
      statHeaders.forEach((header) => {
        const value = columns[headers.indexOf(header)];
        stats[header] = Number.isNaN(Number(value)) ? value : Number(value);
      });
      return { player, stats };
    });

  return { statHeaders, entries };
};

const unique = (values) => Array.from(new Set(values));

window.basketStatData = {
  loadData,
  saveData,
  parseCsv,
  unique,
};
