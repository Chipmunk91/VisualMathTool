// Predefined vector colors (colorblind-friendly)
const VECTOR_COLORS = [
  "#E69F00", // Orange
  "#56B4E9", // Light Blue
  "#009E73", // Green
  "#F0E442", // Yellow
  "#0072B2", // Dark Blue
  "#D55E00", // Red
  "#CC79A7", // Pink
  "#999999", // Grey
];

// Basic color palette for the color picker (first row)
export const COLOR_PALETTE_BASIC = [
  "#000000", // Black
  "#404040", // Dark Gray
  "#808080", // Medium Gray
  "#990000", // Dark Red
  "#FF0000", // Red
  "#FF9900", // Orange
  "#FFFF00", // Yellow
  "#00FF00", // Green
  "#00FFFF", // Cyan
  "#0000FF", // Blue
  "#9900FF", // Purple
  "#FF00FF", // Magenta
];

// Extended color palette (second row)
export const COLOR_PALETTE_EXTENDED = [
  "#FFFFFF", // White
  "#CCCCCC", // Light Gray
  "#C0C0C0", // Silver
  "#993300", // Brown
  "#FF6666", // Light Red
  "#FFCC99", // Light Orange
  "#FFFF99", // Light Yellow
  "#99FF99", // Light Green
  "#99FFFF", // Light Cyan
  "#9999FF", // Light Blue
  "#CC99FF", // Light Purple
  "#FF99FF", // Light Magenta
];

// Pastel color palette (third row)
export const COLOR_PALETTE_PASTEL = [
  "#FDFDFD", // Off White
  "#F2F2F2", // Very Light Gray
  "#D9D9D9", // Lighter Gray
  "#FFE6E6", // Pastel Red
  "#FFE1CC", // Pastel Orange
  "#FFFFCC", // Pastel Yellow
  "#E6FFE6", // Pastel Green
  "#E6FFFF", // Pastel Cyan
  "#E6E6FF", // Pastel Blue
  "#F9E6FF", // Pastel Purple
  "#FFE6FF", // Pastel Magenta
  "#FFCCE6", // Pastel Pink
];

/**
 * Get a random color from the predefined list
 * @param existingColors Optional array of colors to avoid
 * @returns A color string in hex format
 */
export function getRandomColor(existingColors: string[] = []): string {
  // If we have existing colors, try to pick one that's not used yet
  if (existingColors.length > 0 && existingColors.length < VECTOR_COLORS.length) {
    // Find colors that aren't already in use
    const availableColors = VECTOR_COLORS.filter(color => !existingColors.includes(color));
    if (availableColors.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableColors.length);
      return availableColors[randomIndex];
    }
  }
  
  // Otherwise just pick a random color
  const randomIndex = Math.floor(Math.random() * VECTOR_COLORS.length);
  return VECTOR_COLORS[randomIndex];
}

/**
 * Get the next available color that hasn't been used recently
 * @param usedColors Array of colors that have been used
 * @returns A color string in hex format
 */
export function getNextColor(usedColors: string[] = []): string {
  // If all colors have been used, just return a random one
  if (usedColors.length >= VECTOR_COLORS.length) {
    return getRandomColor();
  }
  
  // Find the first unused color
  const availableColor = VECTOR_COLORS.find(color => !usedColors.includes(color));
  return availableColor || getRandomColor();
}

/**
 * Create a lighter version of a color for transformed vectors
 * @param hexColor The original color in hex format
 * @returns A lighter version of the color
 */
export function getLighterColor(hexColor: string): string {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  
  // Make it lighter
  const lighterR = Math.min(255, r + 80);
  const lighterG = Math.min(255, g + 80);
  const lighterB = Math.min(255, b + 80);
  
  // Convert back to hex
  return `#${lighterR.toString(16).padStart(2, '0')}${lighterG.toString(16).padStart(2, '0')}${lighterB.toString(16).padStart(2, '0')}`;
}
