import { main } from "../../../src/worker";
import { createExportBarrier } from "./export-barrier";

const barrier = createExportBarrier();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    barrier.release();
    barrier.server.close();
  });
}
barrier.server.listen(3103, "127.0.0.1", () => {
  void main({ afterClaim: barrier.afterClaim }).catch(() => {
    barrier.release();
    barrier.server.close();
    process.exit(1);
  });
});
