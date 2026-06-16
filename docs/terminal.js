'use strict';

(function () {
  var NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;
  var REPO_RE = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;

  var COMMANDS = [
    { prefix: 'fleet audit', fn: fleetAudit },
    { prefix: 'log week',    fn: logWeek },
    { prefix: 'env scan',    fn: envScan },
  ];

  // ── bootstrap ────────────────────────────────────────────────
  function init() {
    var form   = document.getElementById('term-form');
    var input  = document.getElementById('term-input');
    var output = document.getElementById('term-output');
    if (!form || !input || !output) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input.value.trim();
      if (!raw || input.disabled) return;
      input.value = '';
      input.disabled = true;
      addLine(output, sp('tp', '$ clude ') + esc(raw));
      dispatch(raw, output).then(function () {
        input.disabled = false;
        input.focus();
      });
    });

    // Click-to-load examples
    document.querySelectorAll('[data-cmd]').forEach(function (el) {
      el.addEventListener('click', function () {
        input.value = el.dataset.cmd;
        input.focus();
      });
    });
  }

  // ── command dispatch ─────────────────────────────────────────
  async function dispatch(raw, out) {
    var lower = raw.toLowerCase();
    for (var i = 0; i < COMMANDS.length; i++) {
      var cmd = COMMANDS[i];
      if (lower === cmd.prefix || lower.startsWith(cmd.prefix + ' ')) {
        await cmd.fn(raw.slice(cmd.prefix.length).trim(), out);
        return;
      }
    }
    addLine(out, sp('tr', 'Unknown command.') +
      ' Try: fleet audit &lt;user&gt;, log week &lt;user&gt;, env scan &lt;owner/repo&gt;');
  }

  // ── fleet audit ──────────────────────────────────────────────
  async function fleetAudit(user, out) {
    if (!user) { addLine(out, sp('tr', 'Usage: fleet audit &lt;github-username&gt;')); return; }
    if (!NAME_RE.test(user)) { addLine(out, sp('tr', 'Invalid username')); return; }

    var loading = addLine(out, sp('td', 'Fetching repos for ' + esc(user) + '...'));
    try {
      var data = await apiFetch('/api/fleet?user=' + encodeURIComponent(user));
      loading.remove();
      if (data.error) { addLine(out, sp('tr', esc(data.error))); return; }

      var repos = data.repos.filter(function (r) { return !r.archived; });
      addLine(out, '');
      addLine(out,
        sp('bold', 'Fleet Audit') + '  ' + sp('tc', esc(user)) +
        '  ' + sp('td', repos.length + ' public repos')
      );
      addLine(out, '');

      var w = clamp(20, 40, maxLen(repos, function (r) { return r.name.length; }));
      addLine(out, sp('td',
        pE(w, 'Repository') + pS(14, 'Last Push') + pS(9, 'Issues') + pS(8, 'Stars') + '  Language'
      ));
      addLine(out, sp('td', '─'.repeat(w + 14 + 9 + 8 + 12)));

      repos.slice(0, 25).forEach(function (r) {
        var pushed = r.pushed_at ? relTime(new Date(r.pushed_at)) : 'never';
        addLine(out,
          sp('tc', pE(w, r.name)) +
          sp('td', pS(14, pushed)) +
          sp(r.open_issues > 0 ? 'ty' : 'tg', pS(9, r.open_issues)) +
          sp('td', pS(8, r.stars)) +
          '  ' + sp('td', esc(r.language || ''))
        );
      });
      if (repos.length > 25) addLine(out, sp('td', '... and ' + (repos.length - 25) + ' more'));
      addLine(out, '');
    } catch (_) {
      loading.remove();
      addLine(out, sp('tr', 'Request failed'));
    }
  }

  // ── log week ─────────────────────────────────────────────────
  async function logWeek(user, out) {
    if (!user) { addLine(out, sp('tr', 'Usage: log week &lt;github-username&gt;')); return; }
    if (!NAME_RE.test(user)) { addLine(out, sp('tr', 'Invalid username')); return; }

    var loading = addLine(out, sp('td', 'Fetching activity for ' + esc(user) + '...'));
    try {
      var data = await apiFetch('/api/log?user=' + encodeURIComponent(user) + '&days=7');
      loading.remove();
      if (data.error) { addLine(out, sp('tr', esc(data.error))); return; }

      var repoNames = Object.keys(data.by_repo).sort();
      var total = repoNames.reduce(function (s, r) { return s + data.by_repo[r].length; }, 0);

      if (total === 0) {
        addLine(out, sp('td', 'No public commits found in the past 7 days for ' + esc(user) + '.'));
        return;
      }

      addLine(out, '');
      addLine(out,
        sp('bold', 'Past 7 Days') + '  ' + sp('tc', esc(user)) +
        '  ' + sp('td', total + ' commit(s) across ' + repoNames.length + ' repo(s)')
      );
      addLine(out, '');

      repoNames.forEach(function (repo) {
        var commits = data.by_repo[repo];
        addLine(out,
          sp('tc bold', esc(repo)) + ' ' +
          sp('td', '(' + commits.length + ' commit' + (commits.length !== 1 ? 's' : '') + ')')
        );
        commits.forEach(function (c) {
          var d = new Date(c.date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
          addLine(out,
            '  ' + sp('td', pE(12, d)) +
            '  ' + sp('ty', esc(c.hash)) +
            '  ' + esc(c.message)
          );
        });
        addLine(out, '');
      });
    } catch (_) {
      loading.remove();
      addLine(out, sp('tr', 'Request failed'));
    }
  }

  // ── env scan ─────────────────────────────────────────────────
  async function envScan(repo, out) {
    if (!repo) { addLine(out, sp('tr', 'Usage: env scan &lt;owner/repo&gt;')); return; }
    if (!REPO_RE.test(repo)) { addLine(out, sp('tr', 'Invalid format. Use: owner/repo')); return; }

    var loading = addLine(out, sp('td', 'Scanning ' + esc(repo) + ' for env var usage...'));
    try {
      var data = await apiFetch('/api/env?repo=' + encodeURIComponent(repo));
      loading.remove();
      if (data.error) { addLine(out, sp('tr', esc(data.error))); return; }

      addLine(out, '');
      addLine(out,
        sp('bold', 'Env Scan') + '  ' + sp('tc', esc(repo)) +
        '  ' + sp('td', data.files_scanned + ' files scanned')
      );
      addLine(out, '');

      if (data.vars.length === 0) {
        addLine(out, sp('td', 'No environment variable usage found.'));
        return;
      }

      var w = clamp(16, 40, maxLen(data.vars, function (v) { return v.name.length; }));
      addLine(out, sp('td', pE(w, 'Variable') + pS(8, 'Refs') + '  Files'));
      addLine(out, sp('td', '─'.repeat(w + 8 + 30)));

      data.vars.forEach(function (v) {
        var files = v.files.slice(0, 2).join(', ') + (v.files.length > 2 ? ' +' + (v.files.length - 2) : '');
        addLine(out,
          sp('tc bold', pE(w, v.name)) +
          sp('tm', pS(8, v.refs)) +
          '  ' + sp('td', esc(files))
        );
      });
      addLine(out, '');
      var totalRefs = data.vars.reduce(function (s, v) { return s + v.refs; }, 0);
      addLine(out, sp('td', data.vars.length + ' unique variable(s)  ' + totalRefs + ' total reference(s)'));
    } catch (_) {
      loading.remove();
      addLine(out, sp('tr', 'Request failed'));
    }
  }

  // ── helpers ──────────────────────────────────────────────────
  async function apiFetch(url) {
    var resp = await fetch(url);
    if (!resp.ok && resp.status !== 400 && resp.status !== 404) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  function addLine(container, html) {
    var el = document.createElement('div');
    el.className = 'term-line';
    el.innerHTML = typeof html === 'string' ? html : '';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  // All user/API data MUST pass through esc() before innerHTML
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sp(cls, content) {
    return '<span class="' + cls + '">' + content + '</span>';
  }

  // pad-end (right-align text, then escape)
  function pE(len, s) { return esc(String(s).padEnd(len)); }
  // pad-start (left-align numbers, then escape)
  function pS(len, s) { return esc(String(s).padStart(len)); }

  function clamp(min, max, n) { return Math.min(max, Math.max(min, n)); }

  function maxLen(arr, fn) {
    return arr.reduce(function (m, item) { return Math.max(m, fn(item)); }, 0);
  }

  function relTime(date) {
    var diff = Date.now() - date.getTime();
    var days = Math.floor(diff / 86400000);
    if (days < 0) return 'just now';
    if (days === 0) {
      var h = Math.floor(diff / 3600000);
      return h === 0 ? Math.floor(diff / 60000) + 'm ago' : h + 'h ago';
    }
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    return Math.floor(days / 30) + 'mo ago';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
