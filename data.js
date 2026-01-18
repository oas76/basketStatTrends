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

/**
 * Extract player name from "#XX Name" format
 * e.g., "#22 Christoffer" -> "Christoffer"
 */
const extractPlayerName = (playerString) => {
  const trimmed = playerString.trim();
  // Match "#number Name" pattern and extract the name
  const match = trimmed.match(/^#\d+\s+(.+)$/);
  return match ? match[1].trim() : trimmed;
};

/**
 * Parse a stat value that may be in various formats:
 * - "9-19" (made-attempted) -> { made: 9, attempted: 19 }
 * - "47%" -> 47 (as percentage number)
 * - "-" -> null
 * - "10" -> 10 (plain number)
 */
const parseStatValue = (value, header) => {
  const trimmed = value.trim();
  
  // Empty or dash means no data
  if (trimmed === "-" || trimmed === "") {
    return null;
  }
  
  // Made-attempted format (e.g., "9-19")
  if (/^\d+-\d+$/.test(trimmed)) {
    const [made, attempted] = trimmed.split("-").map(Number);
    return { made, attempted };
  }
  
  // Percentage format (e.g., "47%")
  if (trimmed.endsWith("%")) {
    const numValue = parseInt(trimmed.replace("%", ""), 10);
    return Number.isNaN(numValue) ? null : numValue;
  }
  
  // Plain number
  const numValue = Number(trimmed);
  return Number.isNaN(numValue) ? trimmed : numValue;
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
    // Filter out rows that don't start with "#" (team totals, etc.)
    .filter((columns) => columns[playerIndex].trim().startsWith("#"))
    .map((columns) => {
      const rawPlayer = columns[playerIndex];
      const name = extractPlayerName(rawPlayer);
      const stats = {};
      statHeaders.forEach((header) => {
        const value = columns[headers.indexOf(header)];
        stats[header] = parseStatValue(value, header);
      });
      return { name, stats };
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
