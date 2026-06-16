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

  if (!NAME_RE.test(user)) {
    return Response.json({ error: 'Invalid username' }, { status: 400 });
  }

  const headers = ghHeaders(context.env.GITHUB_TOKEN);
  const resp = await fetch(
    `https://api.github.com/users/${user}/repos?per_page=100&type=public&sort=pushed`,
    { headers }
  );

  if (resp.status === 404) return Response.json({ error: 'User not found' }, { status: 404 });
  if (resp.status === 403 || resp.status === 429) return Response.json({ error: 'GitHub rate limit exceeded. Try again in a minute.' }, { status: 429 });
  if (!resp.ok) return Response.json({ error: 'GitHub API error (' + resp.status + ')' }, { status: 502 });

  const raw = await resp.json();
  const repos = raw.map(r => ({
    name: r.name,
    pushed_at: r.pushed_at,
    open_issues: r.open_issues_count,
    stars: r.stargazers_count,
    language: r.language,
    archived: r.archived,
    fork: r.fork,
  }));

  return Response.json({ user, repos });
}
