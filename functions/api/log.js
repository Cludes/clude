const NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;

function ghHeaders(token) {
  return {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'clude-cli/0.1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const user = searchParams.get('user') || '';
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 30);

  if (!NAME_RE.test(user)) {
    return Response.json({ error: 'Invalid username' }, { status: 400 });
  }

  const headers = ghHeaders(context.env.GITHUB_TOKEN);
  const since = new Date(Date.now() - days * 86400000);
  const events = [];

  for (let page = 1; page <= 3; page++) {
    const resp = await fetch(
      `https://api.github.com/users/${user}/events/public?per_page=100&page=${page}`,
      { headers }
    );
    if (resp.status === 404) return Response.json({ error: 'User not found' }, { status: 404 });
    if (!resp.ok) break;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;
    events.push(...data);
    if (new Date(data[data.length - 1].created_at) < since) break;
  }

  const byRepo = {};
  for (const ev of events) {
    if (ev.type !== 'PushEvent') continue;
    if (new Date(ev.created_at) < since) continue;
    const repo = ev.repo.name;
    if (!byRepo[repo]) byRepo[repo] = [];
    for (const c of ev.payload.commits || []) {
      byRepo[repo].push({
        hash: c.sha.slice(0, 7),
        message: c.message.split('\n')[0].slice(0, 80),
        date: ev.created_at,
      });
    }
  }

  return Response.json({ user, days, by_repo: byRepo });
}
