import { extractText } from "unpdf";
import { BlueplateError } from "../errors.js";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  let result: { text: string };
  try {
    result = await extractText(buffer, { mergePages: true });
  } catch (error) {
    throw new BlueplateError(
      `PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      "PDF_EXTRACT_ERROR",
    );
  }

  const text = result.text.trim();
  if (!text) {
    throw new BlueplateError(
      "Couldn't read this PDF. Is it a scanned image? Only text-based PDFs are supported.",
      "PDF_EXTRACT_ERROR",
    );
  }

  return text;
}
