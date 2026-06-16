const NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;

function ghHeaders(token) {
  return {
    'Accept': 'application/vnd.github.cloak-preview+json',  // required for search commits API
    'User-Agent': 'clude-cli/0.1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const user = searchParams.get('user') || '';
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 90);

  if (!NAME_RE.test(user)) {
    return Response.json({ error: 'Invalid username' }, { status: 400 });
  }

  const token = context.env.GITHUB_TOKEN;
  const headers = ghHeaders(token);
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]; // YYYY-MM-DD

  // Search Commits API: author: scopes by git author identity, user: restricts to repos owned by
  // this GitHub account - prevents picking up mirror/fork repos authored by a different identity
  // with the same name.
  const url = `https://api.github.com/search/commits?q=author:${encodeURIComponent(user)}+user:${encodeURIComponent(user)}+author-date:>=${since}&sort=author-date&order=desc&per_page=100`;

  const resp = await fetch(url, { headers });

  if (resp.status === 422) {
    return Response.json({ error: 'User not found or no public commits' }, { status: 404 });
  }
  if (resp.status === 403) {
    return Response.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }
  if (!resp.ok) {
    return Response.json({ error: 'GitHub API error' }, { status: 502 });
  }

  const data = await resp.json();
  const items = data.items || [];

  const byRepo = {};
  for (const item of items) {
    const repo = item.repository?.full_name;
    if (!repo) continue;
    if (!byRepo[repo]) byRepo[repo] = [];
    byRepo[repo].push({
      sha: item.sha,
      hash: item.sha.slice(0, 7),
      message: (item.commit.message || '').split('\n')[0].slice(0, 80),
      date: item.commit.author?.date || item.commit.committer?.date,
    });
  }

  return Response.json({ user, days, by_repo: byRepo });
}

