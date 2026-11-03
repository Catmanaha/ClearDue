'use client';
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="standalone">
      <h1>The workspace could not load.</h1>
      <p>
        Reload the workspace to see the latest saved information. If you approved a correction,
        check its saved status before taking another action.
      </p>
      <button className="button" onClick={retry}>
        Reload workspace
      </button>
    </main>
  );
}
