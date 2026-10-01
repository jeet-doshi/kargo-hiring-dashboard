// Runs parsing + PII extraction + anonymisation over every CV in ./applications
// and checks that no detected personal detail survives anonymisation.
import { readFileSync, readdirSync } from "fs";
import { parseCv } from "@/lib/cv/parse";
import { anonymize, assertNoPii, extractPersonalInfo, nameFromFilename } from "@/lib/cv/pii";

const dir = process.argv[2] ?? "applications";
(async () => {
  let failures = 0;
  for (const f of readdirSync(dir)) {
    const text = await parseCv(f, new Uint8Array(readFileSync(`${dir}/${f}`)));
    const pii = extractPersonalInfo(text, f);
    const anon = anonymize(text, pii, [nameFromFilename(f)]);
    let guard = "ok";
    try { assertNoPii(anon, pii); } catch (e) { guard = (e as Error).message; failures++; }
    const fileName = nameFromFilename(f);
    const leaked = (fileName ?? "").split(" ").filter((p) => p && new RegExp(p.length >= 4 ? p : `\b${p}\b`, "i").test(anon));
    if (leaked.length) failures++;
    const leak = leaked.length ? ` NAME-LEAK(${leaked.join(",")})` : "";
    console.log(`${f.padEnd(28)} name=${pii.name ?? "-"} (${pii.nameSource ?? "-"}) email=${pii.email ?? "-"} phone=${pii.phone ?? "-"} guard=${guard}${leak}`);
  }
  console.log(failures ? `${failures} FAILURES` : "ALL PASSED");
})();
