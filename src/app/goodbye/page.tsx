import Link from "next/link";

export default function GoodbyePage() {
  return (
    <main>
      <h1>You are signed out</h1>
      <p>
        If your deletion confirmation was valid, account access has stopped and
        private-data removal is queued. Purging may still be in progress.
      </p>
      <Link href="/">Return home</Link>
    </main>
  );
}
