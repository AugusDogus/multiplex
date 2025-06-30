import "server-only";
import sharp from "sharp";

/**
 * Analyze the bottom portion of an image to determine if progress bar should be dark or light
 * Crops the bottom 10px and analyzes luminosity
 * SERVER-ONLY: This function uses Sharp which only works in Node.js
 */
export async function analyzeImageProgressColor(
  imageUrl: string,
): Promise<"dark" | "light"> {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return "light"; // Default fallback
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    // Use Sharp to process the image
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return "light"; // Default fallback
    }

    // Crop the bottom 10px of the image
    const cropHeight = Math.min(10, metadata.height);
    const croppedImage = image.extract({
      left: 0,
      top: metadata.height - cropHeight,
      width: metadata.width,
      height: cropHeight,
    });

    // Get image statistics to analyze luminosity
    const stats = await croppedImage.stats();

    // Extract RGB channel means (assuming RGB order)
    const rgbChannels = stats.channels.slice(0, 3);
    if (rgbChannels.length < 3) {
      return "light"; // Fallback if not enough channels
    }

    const [rMean, gMean, bMean] = rgbChannels.map((ch) => ch.mean);

    // Calculate perceptually accurate luminance using Rec. 709 standard
    const luminance =
      (0.2126 * rMean! + 0.7152 * gMean! + 0.0722 * bMean!) / 255;

    // Determine if the bottom area is dark or light
    // Using 0.5 as the midpoint (0-1 range for normalized luminance)
    return luminance < 0.5 ? "light" : "dark";
  } catch (error) {
    console.warn("Failed to analyze image for progress color:", error);
    return "light"; // Default fallback
  }
}
