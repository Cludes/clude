const REPO_RE = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.next', 'target', '.cache', '.turbo', 'vendor',
]);

// Store as [source, flags] to always create fresh instances (avoids lastIndex issues)
const PATTERNS = {
  '.js':  [['process\\.env\\.([A-Za-z_]\\w*)', 'g'], ['process\\.env\\[[\'"]([A-Za-z_]\\w*)[\'"]\\]', 'g']],
  '.ts':  [['process\\.env\\.([A-Za-z_]\\w*)', 'g'], ['process\\.env\\[[\'"]([A-Za-z_]\\w*)[\'"]\\]', 'g']],
  '.jsx': [['process\\.env\\.([A-Za-z_]\\w*)', 'g']],
  '.tsx': [['process\\.env\\.([A-Za-z_]\\w*)', 'g']],
  '.mjs': [['process\\.env\\.([A-Za-z_]\\w*)', 'g']],
  '.cjs': [['process\\.env\\.([A-Za-z_]\\w*)', 'g']],
  '.py':  [['os\\.environ\\[[\'"]([A-Za-z_]\\w*)[\'"]\\]', 'g'], ['os\\.getenv\\([\'"]([A-Za-z_]\\w*)[\'"]', 'g']],
  '.go':  [['os\\.Getenv\\("([A-Za-z_]\\w*)"\\)', 'g']],
  '.rb':  [['ENV\\[[\'"]([A-Za-z_]\\w*)[\'"]\\]', 'g']],
  '.rs':  [['env::var\\("([A-Za-z_]\\w*)"\\)', 'g']],
};
const SUPPORTED = new Set(Object.keys(PATTERNS));

function ghHeaders(token) {
  return {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'clude-cli/0.1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function fileExt(path) {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i) : '';
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const repo = searchParams.get('repo') || '';

  if (!REPO_RE.test(repo)) {
    return Response.json({ error: 'Invalid repo (use owner/repo)' }, { status: 400 });
  }

  const token = context.env.GITHUB_TOKEN;
  const headers = ghHeaders(token);

  const repoResp = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (repoResp.status === 404) return Response.json({ error: 'Repo not found' }, { status: 404 });
  if (!repoResp.ok) return Response.json({ error: 'GitHub API error' }, { status: 502 });
  const repoData = await repoResp.json();
  const branch = repoData.default_branch || 'main';

  const treeResp = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );
  if (!treeResp.ok) return Response.json({ error: 'Could not fetch repo tree' }, { status: 502 });
  const { tree = [] } = await treeResp.json();

  const files = tree
    .filter(item =>
      item.type === 'blob' &&
      SUPPORTED.has(fileExt(item.path)) &&
      !item.path.split('/').some(p => SKIP_DIRS.has(p))
    )
    .slice(0, 20);

  if (files.length === 0) {
    return Response.json({ repo, vars: [], files_scanned: 0 });
  }

  const rawHeaders = { ...headers, 'Accept': 'application/vnd.github.raw+json' };
  const scanResults = await Promise.all(
    files.map(async file => {
      const resp = await fetch(
        `https://api.github.com/repos/${repo}/contents/${file.path}`,
        { headers: rawHeaders }
      );
      if (!resp.ok) return [];
      const content = await resp.text();
      const patterns = PATTERNS[fileExt(file.path)] || [];
      const found = [];
      for (const [source, flags] of patterns) {
        const re = new RegExp(source, flags);
        for (const m of content.matchAll(re)) {
          found.push({ name: m[1], file: file.path });
        }
      }
      return found;
    })
  );

  const byName = {};
  for (const results of scanResults) {
    for (const { name, file } of results) {
      if (!byName[name]) byName[name] = { name, refs: 0, files: new Set() };
      byName[name].refs++;
      byName[name].files.add(file);
    }
  }

  const vars = Object.values(byName)
    .map(v => ({ name: v.name, refs: v.refs, files: [...v.files] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ repo, vars, files_scanned: files.length });
}
