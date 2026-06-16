const GH = 'https://api.github.com';
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;
const NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.next', 'target', '.cache', '.turbo', 'vendor',
]);

// Cloudflare Pages Functions allow a limited number of subrequests per request
// (50 on the free plan). Stay comfortably under it so large orgs never crash.
const MAX_SUBREQUESTS = 45;
const USER_MAX_REPOS = 10;
const USER_FILES_PER_REPO = 4;
const REPO_MAX_FILES = 20;

// env var usage patterns, per extension. Stored as [source, flags] so each scan
// builds a fresh RegExp (avoids shared lastIndex bugs).
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

// High-signal secret detectors. [label, source] -> fresh RegExp per file.
const SECRET_PATTERNS = [
  ['AWS access key', 'AKIA[0-9A-Z]{16}'],
  ['GitHub token', '\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\\b'],
  ['GitHub fine-grained PAT', '\\bgithub_pat_[A-Za-z0-9_]{82}\\b'],
  ['Slack token', '\\bxox[baprs]-[A-Za-z0-9-]{10,48}\\b'],
  ['Stripe live key', '\\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\\b'],
  ['Google API key', '\\bAIza[0-9A-Za-z_\\-]{35}\\b'],
  ['OpenAI key', '\\bsk-(?:proj-)?[A-Za-z0-9]{20,}\\b'],
  ['npm token', '\\bnpm_[A-Za-z0-9]{36}\\b'],
  ['SendGrid key', '\\bSG\\.[A-Za-z0-9_\\-]{22}\\.[A-Za-z0-9_\\-]{43}\\b'],
  ['Private key', '-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----'],
];

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

function redact(raw) {
  const s = String(raw).replace(/\s+/g, '');
  if (s.length <= 10) return s.slice(0, 3) + '***';
  return s.slice(0, 4) + '***' + s.slice(-3);
}

// Turn a failed GitHub response into a clear, actionable error response.
function ghErrorResponse(resp) {
  if (resp.status === 401) {
    return Response.json({ error: 'GitHub authentication failed - the server GITHUB_TOKEN is missing, invalid, or expired.' }, { status: 502 });
  }
  if (resp.status === 403 || resp.status === 429) {
    const remaining = resp.headers.get('x-ratelimit-remaining');
    if (remaining === '0' || resp.status === 429) {
      const reset = Number(resp.headers.get('x-ratelimit-reset') || 0);
      const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
      return Response.json({ error: `GitHub rate limit reached${mins ? `, resets in ~${mins} min` : ''}.` }, { status: 429 });
    }
    return Response.json({ error: 'GitHub denied the request (403).' }, { status: 502 });
  }
  return Response.json({ error: `GitHub API error (${resp.status}).` }, { status: 502 });
}

function scanContent(content, ext, filePath) {
  const vars = [];
  for (const [source, flags] of (PATTERNS[ext] || [])) {
    const re = new RegExp(source, flags);
    for (const m of content.matchAll(re)) vars.push({ name: m[1], file: filePath });
  }
  const secrets = [];
  const seen = new Set();
  for (const [label, source] of SECRET_PATTERNS) {
    const re = new RegExp(source, 'g');
    for (const m of content.matchAll(re)) {
      const preview = label === 'Private key' ? '(private key block)' : redact(m[0]);
      const key = `${label}|${preview}|${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      secrets.push({ type: label, file: filePath, preview });
    }
  }
  return { vars, secrets };
}

// Scan one repo's files for env vars + secrets, respecting the subrequest budget.
async function scanRepoFiles(repoFullName, branch, headers, rawHeaders, budget, maxFiles) {
  if (budget.left <= 0) return { vars: [], secrets: [], files_scanned: 0 };
  budget.left--;
  const treeResp = await fetch(`${GH}/repos/${repoFullName}/git/trees/${branch}?recursive=1`, { headers });
  if (!treeResp.ok) return { vars: [], secrets: [], files_scanned: 0 };
  const { tree = [] } = await treeResp.json();

  const candidates = tree.filter(item =>
    item.type === 'blob' &&
    SUPPORTED.has(fileExt(item.path)) &&
    !item.path.split('/').some(p => SKIP_DIRS.has(p))
  );
  const take = Math.max(0, Math.min(maxFiles, candidates.length, budget.left));
  const files = candidates.slice(0, take);
  budget.left -= files.length;

  const results = await Promise.all(files.map(async file => {
    const resp = await fetch(`${GH}/repos/${repoFullName}/contents/${file.path}`, { headers: rawHeaders });
    if (!resp.ok) return { vars: [], secrets: [] };
    const content = await resp.text();
    return scanContent(content, fileExt(file.path), file.path);
  }));

  const byName = {};
  const secrets = [];
  for (const r of results) {
    for (const { name, file } of r.vars) {
      if (!byName[name]) byName[name] = { name, refs: 0, files: new Set() };
      byName[name].refs++;
      byName[name].files.add(file);
    }
    for (const s of r.secrets) secrets.push(s);
  }
  const vars = Object.values(byName)
    .map(v => ({ name: v.name, refs: v.refs, files: [...v.files] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { vars, secrets, files_scanned: files.length };
}

async function handle(context) {
  const { searchParams } = new URL(context.request.url);
  const repo = searchParams.get('repo') || '';
  const user = searchParams.get('user') || '';

  const token = context.env.GITHUB_TOKEN;
  const headers = ghHeaders(token);
  const rawHeaders = { ...headers, 'Accept': 'application/vnd.github.raw+json' };
  const budget = { left: MAX_SUBREQUESTS };

  // ── Single repo mode ──────────────────────────────────────────
  if (repo) {
    if (!REPO_RE.test(repo)) return Response.json({ error: 'Invalid repo (use owner/repo)' }, { status: 400 });

    budget.left--;
    const repoResp = await fetch(`${GH}/repos/${repo}`, { headers });
    if (repoResp.status === 404) return Response.json({ error: 'Repo not found' }, { status: 404 });
    if (!repoResp.ok) return ghErrorResponse(repoResp);
    const repoData = await repoResp.json();
    const branch = repoData.default_branch || 'main';

    const res = await scanRepoFiles(repo, branch, headers, rawHeaders, budget, REPO_MAX_FILES);
    return Response.json({ repo, vars: res.vars, secrets: res.secrets, files_scanned: res.files_scanned });
  }

  // ── User (all repos) mode ─────────────────────────────────────
  if (user) {
    if (!NAME_RE.test(user)) return Response.json({ error: 'Invalid username' }, { status: 400 });

    budget.left--;
    const reposResp = await fetch(`${GH}/users/${user}/repos?per_page=100&type=public&sort=pushed`, { headers });
    if (reposResp.status === 404) return Response.json({ error: 'User not found' }, { status: 404 });
    if (!reposResp.ok) return ghErrorResponse(reposResp);

    const allRepos = await reposResp.json();
    if (!Array.isArray(allRepos)) return Response.json({ error: 'Unexpected GitHub response' }, { status: 502 });

    const activeRepos = allRepos.filter(r => !r.archived && !r.fork).slice(0, USER_MAX_REPOS);
    const globalVars = {};
    const byRepo = {};
    const secrets = [];
    let totalFiles = 0;

    // Sequential across repos so the shared subrequest budget is honored exactly.
    for (const r of activeRepos) {
      if (budget.left <= 1) break;
      const res = await scanRepoFiles(r.full_name, r.default_branch || 'main', headers, rawHeaders, budget, USER_FILES_PER_REPO);
      totalFiles += res.files_scanned;
      if (res.vars.length) {
        byRepo[r.full_name] = res.vars;
        for (const v of res.vars) {
          if (!globalVars[v.name]) globalVars[v.name] = { name: v.name, refs: 0, repos: new Set() };
          globalVars[v.name].refs += v.refs;
          globalVars[v.name].repos.add(r.full_name.split('/')[1]);
        }
      }
      for (const s of res.secrets) secrets.push({ ...s, repo: r.full_name });
    }

    const vars = Object.values(globalVars)
      .map(v => ({ name: v.name, refs: v.refs, repos: [...v.repos].sort() }))
      .sort((a, b) => b.refs - a.refs);

    return Response.json({
      user,
      vars,
      by_repo: byRepo,
      secrets,
      repos_scanned: Object.keys(byRepo).length,
      repos_checked: activeRepos.length,
      files_scanned: totalFiles,
    });
  }

  return Response.json({ error: 'Provide ?repo=owner/repo or ?user=username' }, { status: 400 });
}

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (err) {
    return Response.json({ error: `Scan failed: ${err && err.message ? err.message : String(err)}` }, { status: 500 });
  }
}
