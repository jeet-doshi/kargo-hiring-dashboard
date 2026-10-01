import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { AppError } from "@/lib/errors";

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_TEXT_CHARS = 200;

type Kind = "pdf" | "docx" | "txt";

function detectKind(filename: string, bytes: Uint8Array): Kind | null {
  const ext = filename.toLowerCase().split(".").pop();
  // Check magic bytes rather than trusting the extension alone.
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // PK (docx is a zip)
  if (ext === "pdf" && isPdf) return "pdf";
  if (ext === "docx" && isZip) return "docx";
  if (ext === "txt") return "txt";
  return null;
}

/** Normalise whitespace and strip characters that PDF extraction commonly mangles. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Turn an uploaded file into plain text. Throws AppError with a
 * founder-readable message for unsupported, corrupt or empty files.
 */
export async function parseCv(filename: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new AppError("EMPTY_FILE", "The uploaded file is empty.", 400);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "The file is larger than 5 MB. Please upload a smaller CV.", 400);
  }

  const kind = detectKind(filename, bytes);
  if (!kind) {
    throw new AppError(
      "UNSUPPORTED_FILE",
      "Unsupported or invalid file. Please upload a PDF, DOCX or TXT CV.",
      400,
    );
  }

  let text: string;
  try {
    if (kind === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractText(pdf, { mergePages: true });
      text = result.text;
    } else if (kind === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    throw new AppError(
      "UNREADABLE_FILE",
      "We couldn't read this file. It may be corrupt or password-protected.",
      400,
    );
  }

  text = cleanText(text);
  if (text.length < MIN_TEXT_CHARS) {
    throw new AppError(
      "EMPTY_CV",
      "This CV has little or no readable text (it may be a scanned image). Please upload a text-based CV.",
      400,
    );
  }
  return text;
}
