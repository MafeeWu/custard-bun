import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>AI Companion</h1>
      <p>Private conversations with characters who remember what matters.</p>
      <Link href="/auth/sign-up">Get started</Link>
    </main>
  );
}
