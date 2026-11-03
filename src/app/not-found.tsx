import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>This page is unavailable.</h1>
      <p>Check the link or return to your workspace.</p>
      <Link className="button" href="/">
        Open case queue
      </Link>
    </main>
  );
}
