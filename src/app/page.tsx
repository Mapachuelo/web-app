export default function Home() {
  return (
    <main className="page">
      <h1>sync-app web</h1>
      <p>API de sincronizacion activa.</p>
      <ul>
        <li>
          <code>POST /api/users</code> upsert idempotente (header X-Api-Key)
        </li>
        <li>
          <code>GET /api/users?since=&amp;limit=</code> pull incremental
        </li>
        <li>
          <code>GET /api/health</code> estado del servicio
        </li>
      </ul>
    </main>
  );
}
