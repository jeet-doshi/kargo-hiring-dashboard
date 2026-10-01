import { AppError } from "@/lib/errors";
import { MAX_FILE_BYTES } from "@/lib/cv/parse";
import { respond } from "@/lib/server/http";
import { processUpload } from "@/lib/server/pipeline";
import type { Role } from "@/lib/types";

// Extraction + two scoring calls + email + briefs can take a while.
export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("BAD_REQUEST", "The upload could not be read. Please try again.", 400);
    }
    const role = form.get("role");
    const file = form.get("file");
    if (role !== "PM" && role !== "SPM") {
      throw new AppError("BAD_ROLE", "Please select Product Manager or Senior Product Manager.", 400);
    }
    if (!(file instanceof File)) throw new AppError("NO_FILE", "Please choose a CV file to upload.", 400);
    if (file.size > MAX_FILE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "The file is larger than 5 MB. Please upload a smaller CV.", 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return processUpload({ name: file.name, bytes }, role as Role);
  });
}
