import Link from "next/link";

export default function GoodbyePage() {
  return (
    <main>
      <h1>Your account has been deleted</h1>
      <Link href="/">Return home</Link>
    </main>
  );
}
