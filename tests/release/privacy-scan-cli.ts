import { scanPrivacySurfaces } from "./privacy-scan";

void scanPrivacySurfaces(process.argv[2] ?? "test-results/privacy-release")
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    console.error("Privacy release gate failed");
    process.exitCode = 1;
  });
