'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WEB_DIR = path.join(__dirname, '..', 'public');
const HOOK_TOKEN = process.env.HOOK_TOKEN || '';
const RETENTION_MS = (Number(process.env.RETENTION_DAYS) || 7) * 86400e3;
// Un PostToolUse de Read ou de Bash peut porter plusieurs Mo de sortie
const MAX_BODY = 20 * 1024 * 1024;
const MAX_EVENTS = 500;
const MAX_SESSIONS = 300;
const TEXT_LIMIT = 20000;
const DETAIL_LIMIT = 4000;
const PENDING_TTL = 10 * 60e3;
const MAX_TURNS = 200;
// Même seuil que l'interface : une session « en cours » muette depuis 10 min est considérée comme morte
const STALE_MS = 10 * 60e3;
const IDLE_PROMPT_MESSAGE = 'Claude is waiting for your input';
const CLEANUP_CHOICES = [0, 3600e3, 86400e3, 7 * 86400e3];
const MAX_HISTORY = 5000;
const HISTORY_MS = 30 * 86400e3;
const ACTIVITY_MS = 8 * 86400e3;
const HOUR_MS = 3600e3;
const MAX_TASKS = 200;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.sh': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const IMMUTABLE = 'public, max-age=31536000, immutable';

const json = (res, code, body) => {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req, raw = false) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { code: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

async function writeAtomic(file, data) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

// --- Mise en forme des charges utiles ---

const clip = (text, limit) => {
  if (text == null) return null;
  const s = String(text);
  return s.length > limit ? `${s.slice(0, limit)}\n… (${s.length - limit} caractères tronqués)` : s;
};

const format = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const firstString = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const v = Object.values(obj).find((x) => typeof x === 'string');
  return v ?? null;
};

// Une ligne qui résume l'appel d'outil, affichée sous l'agent
function toolSummary(tool, input) {
  const i = input && typeof input === 'object' ? input : {};
  let s;
  switch (tool) {
    case 'Bash':
      s = i.description || i.command;
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      s = i.file_path || i.notebook_path;
      break;
    case 'Grep':
    case 'Glob':
      s = i.path ? `${i.pattern} dans ${i.path}` : i.pattern;
      break;
    case 'WebFetch':
      s = i.url;
      break;
    case 'WebSearch':
      s = i.query;
      break;
    case 'Agent':
      s = i.description;
      break;
    case 'Skill':
      s = i.skill;
      break;
    default:
      s = firstString(i);
  }
  return clip(String(s ?? '').replace(/\s+/g, ' ').trim(), 200) || null;
}

function responseText(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(responseText).join('\n');
  if (typeof resp === 'object') {
    if (typeof resp.text === 'string') return resp.text;
    if (Array.isArray(resp.content)) return resp.content.map(responseText).join('\n');
    if (typeof resp.content === 'string') return resp.content;
    if (resp.file && typeof resp.file.content === 'string') return resp.file.content;
    if ('stdout' in resp || 'stderr' in resp) return [resp.stdout, resp.stderr].filter(Boolean).join('\n');
  }
  return format(resp);
}

// --- État ---

let state = { sessions: {}, history: [], settings: { autoCleanupMs: 86400e3 }, counters: {}, activity: {} };

// Appels d'outils et prompts par heure (clé : début de l'heure en ms), pour la heatmap de l'accueil
function countActivity(kind, at) {
  const bucket = (state.activity[Math.floor(at / HOUR_MS) * HOUR_MS] ??= { tools: 0, prompts: 0 });
  bucket[kind] += 1;
}
// --- Télémétrie OpenTelemetry (OTLP/HTTP en JSON) : tokens et coût de chaque requête au modèle ---
// Seuls les compteurs sont gardés : l'événement transporte aussi l'e-mail et les identifiants du compte.
const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheCreation'];
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, requests: 0 });
const otelValue = (v) => (v ? (v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue) : undefined);
const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

function addUsage(into, u) {
  for (const k of TOKEN_KINDS) into[k] += u[k];
  into.cost += u.cost;
  into.requests += 1;
}

// Renvoie l'id de la session concernée, si elle est connue
function recordApiRequest(a, at) {
  const u = { input: count(a.input_tokens), output: count(a.output_tokens), cacheRead: count(a.cache_read_tokens), cacheCreation: count(a.cache_creation_tokens), cost: count(a.cost_usd) };
  const model = String(a.model || 'inconnu').slice(0, 80);
  const bucket = (state.activity[Math.floor(at / HOUR_MS) * HOUR_MS] ??= { tools: 0, prompts: 0 });
  addUsage(((bucket.models ??= {})[model] ??= emptyUsage()), u);
  const s = state.sessions[a['session.id']];
  if (!s) return null;
  s.usage ??= { ...emptyUsage(), models: {} };
  addUsage(s.usage, u);
  addUsage((s.usage.models[model] ??= emptyUsage()), u);
  // Taille du contexte envoyé à la dernière requête
  s.usage.last = { at, model, context: u.input + u.cacheRead + u.cacheCreation };
  return s.id;
}

function handleOtelLogs(body) {
  const touched = new Set();
  for (const rl of body?.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const r of sl.logRecords ?? []) {
        const a = {};
        for (const kv of r.attributes ?? []) a[kv.key] = otelValue(kv.value);
        if (a['event.name'] !== 'api_request') continue;
        const at = Math.min(Date.now(), Number(r.timeUnixNano) / 1e6 || Date.now());
        const id = recordApiRequest(a, at);
        if (id) touched.add(id);
      }
    }
  }
  for (const id of touched) changed(id);
  if (!touched.size) scheduleSave();
}

let version = 0;
const clients = new Set();
// Clients du flux qui reçoivent aussi chaque session modifiée, allégée : toutes ("all", arbre de l'accueil) ou une seule (carte d'une session)
const liveClients = new Map();

const newId = () => crypto.randomBytes(6).toString('hex');

function push(thread, ev) {
  thread.events.push({ id: newId(), at: Date.now(), ...ev });
  if (thread.events.length > MAX_EVENTS) thread.events.splice(0, thread.events.length - MAX_EVENTS);
}

const findTool = (thread, toolUseId) =>
  thread.events.findLast((x) => x.kind === 'tool' && x.toolUseId === toolUseId);

// Un agent isolé travaille dans <dépôt>/.claude/worktrees/<nom> : il appartient au projet du dépôt
const projectRoot = (cwd) => (cwd ? cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '') : null);

// Numéro par machine et projet, jamais réutilisé : le nom d'une session reste le même après un nettoyage
function nextNumber(host, cwd) {
  const key = `${host}|${cwd}`;
  state.counters[key] = (state.counters[key] ?? 0) + 1;
  return state.counters[key];
}

function getSession(e, host, now) {
  let s = state.sessions[e.session_id];
  if (!s) {
    s = state.sessions[e.session_id] = {
      id: e.session_id,
      number: nextNumber(host, projectRoot(e.cwd)),
      name: null,
      agentSeq: 0,
      host,
      cwd: projectRoot(e.cwd),
      cwdFromMain: false,
      currentCwd: e.cwd || null,
      title: null,
      model: null,
      permissionMode: null,
      status: 'idle',
      attention: null,
      attentionAgent: null,
      startedAt: now,
      lastSeen: now,
      endedAt: null,
      events: [],
      agents: {},
      pending: [],
    };
  }
  // Sessions enregistrées avant l'ajout de la timeline
  s.turns ??= [];
  s.tasks ??= {};
  s.lastSeen = now;
  s.host = host;
  if (e.cwd && !e.agent_id) {
    s.currentCwd = e.cwd;
    // Le premier événement a pu venir d'un sous-agent (autre dossier) : le fil principal fait foi
    if (!s.cwdFromMain) {
      s.cwd = projectRoot(e.cwd);
      s.cwdFromMain = true;
    }
  }
  if (e.session_title) s.title = clip(e.session_title, 200);
  if (e.permission_mode) s.permissionMode = e.permission_mode;
  s.pending = s.pending.filter((p) => now - p.at < PENDING_TTL);
  return s;
}

function getAgent(s, id, type, now) {
  let a = s.agents[id];
  if (!a) {
    s.agentSeq = (s.agentSeq ?? 0) + 1;
    a = s.agents[id] = {
      id,
      number: s.agentSeq,
      type: type || null,
      toolUseId: null,
      description: null,
      prompt: null,
      parentId: null,
      model: null,
      status: 'running',
      startedAt: now,
      endedAt: null,
      lastSeen: now,
      lastTool: null,
      result: null,
      tokens: null,
      durationMs: null,
      events: [],
    };
  }
  a.lastSeen = now;
  if (type && !a.type) a.type = type;
  return a;
}

// --- Timeline : tours de conversation et tâches ---

function closeTurn(s, now) {
  const t = s.turns.at(-1);
  if (t && t.end == null) t.end = now;
}

function openTurn(s, now) {
  closeTurn(s, now);
  s.turns.push({ start: now, end: null });
  if (s.turns.length > MAX_TURNS) s.turns.splice(0, s.turns.length - MAX_TURNS);
}

function upsertTask(s, id, fields, now) {
  let t = s.tasks[id];
  if (!t) {
    t = s.tasks[id] = { id, subject: null, description: null, activeForm: null, status: 'pending', owner: null, createdAt: now, startedAt: null, completedAt: null };
    const ids = Object.keys(s.tasks);
    if (ids.length > MAX_TASKS) delete s.tasks[ids[0]];
  }
  for (const [k, v] of Object.entries(fields)) if (v != null) t[k] = v;
  return t;
}

function setTaskStatus(s, t, status, now) {
  if (status === 'in_progress') {
    t.startedAt ??= now;
    t.completedAt = null;
  } else if (status === 'completed') {
    t.completedAt ??= now;
    if (t.startedAt && !t.recorded) {
      t.recorded = true;
      recordDuration(s, 'task', 'task', t.completedAt - t.startedAt);
    }
  } else if (status === 'pending') {
    t.startedAt = null;
    t.completedAt = null;
  }
  t.status = status;
}

function trackTaskTool(s, e, now) {
  const i = e.tool_input || {};
  if (e.tool_name === 'TaskUpdate' && i.taskId != null) {
    const id = String(i.taskId);
    if (i.status === 'deleted') return void delete s.tasks[id];
    const t = upsertTask(s, id, { subject: clip(i.subject, 200), description: clip(i.description, 2000), activeForm: clip(i.activeForm, 200) }, now);
    if (i.status) setTaskStatus(s, t, i.status, now);
  } else if (e.tool_name === 'TodoWrite' && Array.isArray(i.todos)) {
    // TodoWrite renvoie la liste complète : une tâche absente a été retirée
    const seen = new Set();
    for (const todo of i.todos) {
      if (!todo || typeof todo.content !== 'string') continue;
      const id = `todo:${todo.content.slice(0, 200)}`;
      seen.add(id);
      const t = upsertTask(s, id, { subject: clip(todo.content, 200), activeForm: clip(todo.activeForm, 200), owner: e.agent_id }, now);
      if (todo.status && todo.status !== t.status) setTaskStatus(s, t, todo.status, now);
    }
    for (const id of Object.keys(s.tasks)) if (id.startsWith('todo:') && !seen.has(id)) delete s.tasks[id];
  }
}

// Les durées survivent au nettoyage des sessions : les estimations en dépendent
function recordDuration(s, kind, type, d) {
  if (!(d > 0)) return;
  state.history.push({ cwd: s.cwd, kind, type, d, at: Date.now() });
  if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
}

function recordAgent(s, a, now) {
  if (a.recorded) return;
  a.recorded = true;
  recordDuration(s, 'agent', a.type || 'agent', a.durationMs ?? (a.endedAt ?? now) - a.startedAt);
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// Durée médiane des agents terminés, par type : ceux du même projet d'abord, tous les projets sinon
function estimatesFor(cwd) {
  const local = { agent: {}, task: {} };
  const all = { agent: {}, task: {} };
  const cutoff = Date.now() - HISTORY_MS;
  for (const h of state.history) {
    if (h.at < cutoff) continue;
    for (const sc of h.cwd === cwd ? [local, all] : [all]) (sc[h.kind][h.type] ??= []).push(h.d);
  }
  const pick = (l = [], g = []) =>
    l.length >= 3 ? { median: median(l), n: l.length, scope: 'project' } : g.length >= 3 ? { median: median(g), n: g.length, scope: 'all' } : null;
  const agents = {};
  for (const type of Object.keys(all.agent)) {
    const est = pick(local.agent[type], all.agent[type]);
    if (est) agents[type] = est;
  }
  return { agents, tasks: pick(local.task.task, all.task.task) };
}

const SPAWN_KEYS = ['toolUseId', 'type', 'description', 'prompt', 'parentId'];
const spawnOf = (a) => Object.fromEntries(SPAWN_KEYS.map((k) => [k, a[k]]));
const applySpawn = (a, p) => SPAWN_KEYS.forEach((k) => (a[k] = p[k] ?? a[k]));

// Le PostToolUse de l'outil Agent donne enfin le lien certain appel -> agentId.
// SubagentStart n'a fait qu'une supposition (le plus ancien appel du même type) : on la corrige ici.
function linkSpawn(s, toolUseId, resp, now) {
  const a = getAgent(s, resp.agentId, null, now);
  if (a.toolUseId !== toolUseId) {
    const i = s.pending.findIndex((p) => p.toolUseId === toolUseId);
    if (i >= 0) {
      if (a.toolUseId) s.pending.push({ ...spawnOf(a), at: now });
      applySpawn(a, s.pending.splice(i, 1)[0]);
    } else {
      const b = Object.values(s.agents).find((x) => x.toolUseId === toolUseId);
      if (b) {
        const mine = spawnOf(a);
        applySpawn(a, spawnOf(b));
        applySpawn(b, mine);
      }
    }
  }
  if (resp.resolvedModel) a.model = resp.resolvedModel;
  if (resp.status && resp.status !== 'async_launched') {
    if (a.status === 'running') a.status = 'done';
    a.endedAt ??= now;
    if (resp.totalTokens != null) a.tokens = resp.totalTokens;
    if (resp.totalDurationMs != null) a.durationMs = resp.totalDurationMs;
    recordAgent(s, a, now);
    if (!a.result) a.result = clip(responseText(resp.content), TEXT_LIMIT);
  }
}

const SOURCES = { startup: 'démarrée', resume: 'reprise', clear: 'vidée (/clear)', compact: 'compactée', fork: 'dupliquée' };

function handle(e, host) {
  if (!e || typeof e !== 'object' || typeof e.session_id !== 'string' || typeof e.hook_event_name !== 'string') {
    return false;
  }
  const now = Date.now();
  const s = getSession(e, host, now);
  // Agents internes de Claude Code (résumés de progression) : seulement un SubagentStop, sans type ni activité
  if (e.hook_event_name === 'SubagentStop' && e.agent_id && !s.agents[e.agent_id] && !e.agent_type) return true;
  const sub = e.agent_id ? getAgent(s, e.agent_id, e.agent_type, now) : null;
  const thread = sub || s;

  switch (e.hook_event_name) {
    case 'SessionStart':
      s.status = 'idle';
      s.endedAt = null;
      if (e.model) s.model = e.model;
      push(s, { kind: 'notice', text: `Session ${SOURCES[e.source] || e.source || 'démarrée'}` });
      break;
    case 'UserPromptSubmit':
      if (sub) break;
      s.status = 'running';
      s.attention = null;
      s.attentionAgent = null;
      openTurn(s, now);
      countActivity('prompts', now);
      push(s, { kind: 'prompt', text: clip(e.prompt, TEXT_LIMIT), source: e.source || 'user' });
      break;
    case 'PreToolUse': {
      if (sub) sub.status = 'running';
      else s.status = 'running';
      s.attention = null;
      s.attentionAgent = null;
      const summary = toolSummary(e.tool_name, e.tool_input);
      thread.lastTool = { tool: e.tool_name, summary, at: now };
      if (!findTool(thread, e.tool_use_id)) {
        countActivity('tools', now);
        push(thread, {
          kind: 'tool',
          toolUseId: e.tool_use_id,
          tool: e.tool_name,
          summary,
          input: clip(format(e.tool_input), DETAIL_LIMIT),
          pending: true,
        });
      }
      if (e.tool_name === 'Agent' && e.tool_input) {
        s.pending.push({
          toolUseId: e.tool_use_id,
          type: e.tool_input.subagent_type || 'general-purpose',
          description: clip(e.tool_input.description, 200),
          prompt: clip(e.tool_input.prompt, TEXT_LIMIT),
          parentId: e.agent_id || null,
          at: now,
        });
      }
      trackTaskTool(s, e, now);
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const ok = e.hook_event_name === 'PostToolUse';
      // Le PreToolUse peut arriver après (agents parallèles) ou manquer (hooks installés en cours de route)
      let ev = findTool(thread, e.tool_use_id);
      if (!ev) {
        countActivity('tools', now);
        push(thread, {
          kind: 'tool',
          toolUseId: e.tool_use_id,
          tool: e.tool_name,
          summary: toolSummary(e.tool_name, e.tool_input),
          input: clip(format(e.tool_input), DETAIL_LIMIT),
        });
        ev = thread.events.at(-1);
      }
      ev.pending = false;
      ev.ok = ok;
      ev.endedAt = now;
      ev.output = clip(ok ? responseText(e.tool_response) : e.error || format(e.tool_response) || 'Échec', DETAIL_LIMIT);
      if (e.duration_ms != null) ev.durationMs = e.duration_ms;
      if (ok && e.tool_name === 'Agent' && e.tool_response && typeof e.tool_response.agentId === 'string') {
        linkSpawn(s, e.tool_use_id, e.tool_response, now);
      }
      if (ok && e.tool_name === 'TaskCreate' && e.tool_response) {
        const r = e.tool_response;
        const id = r.task?.id ?? r.taskId ?? r.id;
        const i = e.tool_input || {};
        if (id != null) {
          upsertTask(s, String(id), { subject: clip(i.subject, 200), description: clip(i.description, 2000), activeForm: clip(i.activeForm, 200), owner: e.agent_id }, now);
        }
      }
      break;
    }
    case 'SubagentStart': {
      if (!sub || sub.toolUseId) break;
      let i = s.pending.findIndex((p) => p.type === e.agent_type);
      if (i < 0 && s.pending.length) i = 0;
      if (i >= 0) applySpawn(sub, s.pending.splice(i, 1)[0]);
      break;
    }
    case 'SubagentStop':
      if (!sub) break;
      sub.status = 'done';
      sub.endedAt = now;
      if (e.last_assistant_message) sub.result = clip(e.last_assistant_message, TEXT_LIMIT);
      recordAgent(s, sub, now);
      break;
    case 'TaskCreated':
      if (e.task_id == null) break;
      upsertTask(s, String(e.task_id), { subject: clip(e.task_subject, 200), description: clip(e.task_description, 2000), owner: e.agent_id }, now);
      break;
    case 'TaskCompleted':
      if (e.task_id == null) break;
      setTaskStatus(s, upsertTask(s, String(e.task_id), { subject: clip(e.task_subject, 200) }, now), 'completed', now);
      break;
    case 'Stop':
      if (sub) break;
      s.status = 'idle';
      s.attention = null;
      s.attentionAgent = null;
      closeTurn(s, now);
      if (e.last_assistant_message) push(s, { kind: 'message', text: clip(e.last_assistant_message, TEXT_LIMIT) });
      break;
    case 'StopFailure':
      s.status = 'error';
      if (!sub) closeTurn(s, now);
      push(thread, { kind: 'error', text: clip(e.error_details || format(e.error) || 'Erreur', DETAIL_LIMIT) });
      break;
    case 'Notification':
      // idle_prompt arrive 60 s après tout tour terminé : la session est au repos, pas bloquée
      if (e.notification_type !== 'idle_prompt') {
        s.attention = clip(e.message, 300) || 'En attente';
        // Sous-agent qui demande la permission, s'il est indiqué
        s.attentionAgent = e.agent_id || null;
      }
      push(s, { kind: 'notice', text: clip(e.message, 300) || 'Notification' });
      break;
    case 'PermissionRequest':
      push(thread, { kind: 'notice', hook: e.hook_event_name, tool: e.tool_name, text: `Permission demandée : ${e.tool_name}` });
      break;
    case 'PermissionDenied': {
      // Refus du mode auto : l'outil ne s'exécute pas et aucun PostToolUse ne suivra
      let ev = findTool(thread, e.tool_use_id);
      if (!ev) {
        push(thread, { kind: 'tool', toolUseId: e.tool_use_id, tool: e.tool_name, summary: toolSummary(e.tool_name, e.tool_input), input: clip(format(e.tool_input), DETAIL_LIMIT) });
        ev = thread.events.at(-1);
      }
      ev.pending = false;
      ev.ok = false;
      ev.denied = true;
      ev.endedAt = now;
      ev.output = clip(`Refusé : ${e.reason || 'permission refusée'}`, DETAIL_LIMIT);
      break;
    }
    case 'PreCompact':
      push(thread, { kind: 'notice', hook: e.hook_event_name, text: `Compactage du contexte (${e.trigger === 'manual' ? 'manuel' : 'auto'})` });
      break;
    case 'PostCompact':
      push(thread, { kind: 'notice', hook: e.hook_event_name, text: 'Contexte compacté' });
      break;
    case 'PostModelSwitch':
      if (!sub && e.to_model) s.model = e.to_model;
      push(thread, { kind: 'notice', hook: e.hook_event_name, from: e.from_model || null, to: e.to_model || null, text: `Modèle : ${e.from_model} → ${e.to_model}` });
      break;
    case 'InstructionsLoaded':
      push(thread, { kind: 'notice', hook: e.hook_event_name, summary: clip(e.file_path, 300), text: `Instructions chargées : ${e.file_path}` });
      break;
    case 'SessionEnd':
      s.status = 'ended';
      s.endedAt = now;
      closeTurn(s, now);
      s.attention = null;
      s.attentionAgent = null;
      for (const a of Object.values(s.agents)) if (a.status === 'running') a.status = 'stopped';
      push(s, { kind: 'notice', text: `Session terminée (${e.reason || 'fin'})` });
      break;
    default:
      return true;
  }
  changed(s.id);
  return true;
}

// --- Persistance et diffusion ---

let saveTimer = null;
let saving = Promise.resolve();

const isClosed = (s, now) => s.status === 'ended' || (s.status === 'running' && now - s.lastSeen > STALE_MS);

function autoCleanup() {
  const delay = state.settings.autoCleanupMs;
  if (!delay) return;
  const now = Date.now();
  let removed = 0;
  for (const s of Object.values(state.sessions)) {
    if (now - s.lastSeen > delay) {
      delete state.sessions[s.id];
      removed += 1;
    }
  }
  if (removed) changed(null);
}

function prune() {
  const historyCutoff = Date.now() - HISTORY_MS;
  state.history = state.history.filter((h) => h.at >= historyCutoff);
  const activityCutoff = Date.now() - ACTIVITY_MS;
  for (const at of Object.keys(state.activity)) if (Number(at) < activityCutoff) delete state.activity[at];
  const cutoff = Date.now() - RETENTION_MS;
  const list = Object.values(state.sessions).sort((a, b) => b.lastSeen - a.lastSeen);
  list.forEach((s, i) => {
    if (s.lastSeen < cutoff || i >= MAX_SESSIONS) delete state.sessions[s.id];
  });
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    prune();
    const data = JSON.stringify(state);
    saving = saving.then(() => writeAtomic(STATE_FILE, data)).catch((e) => console.error(`save: ${e.message}`));
  }, 1000);
}

function changed(sessionId) {
  version += 1;
  const msg = `event: change\ndata: ${JSON.stringify({ version, session: sessionId })}\n\n`;
  for (const res of clients) res.write(msg);
  const s = sessionId && state.sessions[sessionId];
  if (s && liveClients.size) {
    const live = `event: live\ndata: ${JSON.stringify({ version, session: liveOf(s, Date.now() - STALE_MS) })}\n\n`;
    for (const [res, filter] of liveClients) if (filter === 'all' || filter === s.id) res.write(live);
  }
  scheduleSave();
}

// Sujet en cours : titre donné par Claude Code, sinon premier ligne du dernier prompt
const subjectOf = (s) => s.title || s.events.findLast((x) => x.kind === 'prompt')?.text?.split('\n')[0].slice(0, 200) || null;

const summaryOf = (s) => ({
  ...s,
  events: undefined,
  pending: undefined,
  turns: undefined,
  tasks: undefined,
  eventCount: s.events.length,
  lastEvent: s.events.findLast((x) => x.kind === 'prompt' || x.kind === 'message') ?? null,
  subject: subjectOf(s),
  agents: Object.values(s.agents).map((a) => ({ ...a, events: undefined, prompt: undefined, result: undefined, eventCount: a.events.length })),
});

// Arbre de l'accueil : sessions ouvertes avec leurs derniers événements allégés
const GALAXY_EVENTS = 60;
const lightEvents = (events) =>
  events.slice(-GALAXY_EVENTS).map((e) => ({ ...e, output: undefined, input: e.input ? e.input.slice(0, 400) : e.input, text: e.text ? e.text.slice(0, 120) : e.text }));

const liveOf = (s, cutoff) => ({
  ...s,
  pending: undefined,
  tasks: {},
  estimates: { agents: {}, tasks: null },
  subject: subjectOf(s),
  events: lightEvents(s.events),
  turns: s.turns.slice(-GALAXY_EVENTS),
  agents: Object.fromEntries(
    Object.values(s.agents)
      .filter((a) => a.status === 'running' || (a.endedAt ?? 0) > cutoff)
      .map((a) => [a.id, { ...a, prompt: undefined, result: undefined, events: lightEvents(a.events) }]),
  ),
});

// --- HTTP ---

function hostOf(req) {
  const h = req.headers['x-agent-host'];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 64);
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'inconnu';
}

function stream(req, res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ version })}\n\n`);
  clients.add(res);
  const live = new URL(req.url, 'http://x').searchParams.get('live');
  if (live) liveClients.set(res, live);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    liveClients.delete(res);
  });
}

async function api(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api', 'sessions', '<id>']
  if (parts[1] === 'health') return json(res, 200, { ok: true });

  if (parts[1] === 'hooks' && parts.length === 2) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    if (HOOK_TOKEN && req.headers['x-hook-token'] !== HOOK_TOKEN) return json(res, 401, { error: 'bad token' });
    const body = JSON.parse(await readBody(req));
    if (!handle(body, hostOf(req))) return json(res, 400, { error: 'not a hook payload' });
    res.writeHead(204, SECURITY_HEADERS);
    return res.end();
  }

  if (parts[1] === 'stream' && parts.length === 2 && req.method === 'GET') return stream(req, res);

  if (parts[1] === 'galaxy' && parts.length === 2 && req.method === 'GET') {
    const cutoff = Date.now() - STALE_MS;
    const sessions = Object.values(state.sessions)
      .filter((s) => s.status !== 'ended' && !(s.status === 'running' && s.lastSeen < cutoff))
      .map((s) => liveOf(s, cutoff));
    return json(res, 200, { now: Date.now(), sessions });
  }

  if (parts[1] === 'activity' && parts.length === 2 && req.method === 'GET') {
    const hours = Object.entries(state.activity).map(([at, b]) => ({ at: Number(at), ...b }));
    return json(res, 200, { now: Date.now(), hours });
  }

  if (parts[1] === 'settings' && parts.length === 2) {
    if (req.method === 'GET') return json(res, 200, state.settings);
    if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
    const body = JSON.parse(await readBody(req));
    if (!CLEANUP_CHOICES.includes(body?.autoCleanupMs)) return json(res, 400, { error: `autoCleanupMs must be one of ${CLEANUP_CHOICES}` });
    state.settings.autoCleanupMs = body.autoCleanupMs;
    changed(null);
    autoCleanup();
    return json(res, 200, state.settings);
  }

  if (parts[1] === 'sessions') {
    if (parts.length === 2 && req.method === 'GET') {
      const sessions = Object.values(state.sessions)
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map(summaryOf);
      return json(res, 200, { version, now: Date.now(), settings: state.settings, sessions });
    }
    if (parts.length === 2 && req.method === 'DELETE') {
      const now = Date.now();
      let removed = 0;
      for (const s of Object.values(state.sessions)) {
        if (isClosed(s, now)) {
          delete state.sessions[s.id];
          removed += 1;
        }
      }
      changed(null);
      return json(res, 200, { removed });
    }
    const s = parts.length === 3 ? state.sessions[parts[2]] : null;
    if (!s) return json(res, 404, { error: 'not found' });
    if (req.method === 'GET') return json(res, 200, { ...s, pending: undefined, subject: subjectOf(s), estimates: estimatesFor(s.cwd) });
    if (req.method === 'PATCH') {
      const body = JSON.parse(await readBody(req));
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : null;
      s.name = name || null;
      changed(s.id);
      return json(res, 200, { name: s.name });
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  return json(res, 404, { error: 'not found' });
}

async function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return json(res, 400, { error: 'bad path' });
  }
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  let file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
  let st = await fs.stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    if (path.extname(rel)) return json(res, 404, { error: 'not found' });
    file = path.join(WEB_DIR, 'index.html');
    st = await fs.stat(file);
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? IMMUTABLE : 'no-cache',
  });
  res.end(await fs.readFile(file));
}

// Point d'arrivée OTLP des journaux : JSON seulement (OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json)
async function otelLogs(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (HOOK_TOKEN && req.headers['x-hook-token'] !== HOOK_TOKEN) return json(res, 401, { error: 'bad token' });
  if (!String(req.headers['content-type'] || '').includes('json')) return json(res, 415, { error: 'use http/json' });
  let raw = await readBody(req, true);
  if (req.headers['content-encoding'] === 'gzip') raw = zlib.gunzipSync(raw, { maxOutputLength: MAX_BODY });
  handleOtelLogs(JSON.parse(raw.toString('utf8')));
  return json(res, 200, {});
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (pathname === '/v1/logs') return await otelLogs(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    await serveStatic(res, pathname);
  } catch (e) {
    if (e.code === 413) return json(res, 413, { error: 'too large' });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'invalid json' });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'internal' });
  }
});

// Le flux SSE reste ouvert : pas de délai sur la requête entière
server.requestTimeout = 0;
server.headersTimeout = 10000;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await writeAtomic(STATE_FILE, JSON.stringify(state)).catch(() => {});
    }
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

(async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let migrate = false;
  let backfill = true;
  try {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    if (saved && typeof saved.sessions === 'object') {
      state = { ...state, ...saved };
      backfill = !saved.activity;
      migrate = !Array.isArray(saved.history);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`load: ${e.message}`);
  }
  state.settings = { autoCleanupMs: 86400e3, ...state.settings };
  for (const s of Object.values(state.sessions)) s.cwd = projectRoot(s.cwd);
  // Attentes enregistrées avant qu'idle_prompt soit ignoré
  for (const s of Object.values(state.sessions)) if (s.attention === IDLE_PROMPT_MESSAGE) s.attention = null;
  for (const s of Object.values(state.sessions)) {
    for (const a of Object.values(s.agents)) {
      if (!a.type && !a.toolUseId && !a.events.length && a.status === 'done' && a.endedAt === a.startedAt) delete s.agents[a.id];
    }
  }
  // Sessions et agents enregistrés avant la numérotation
  state.counters ??= {};
  // Usure par projet des anciennes versions, plus utilisée
  delete state.usage;
  delete state.usageBackfilled;
  // Activité reconstituée depuis les journaux encore en mémoire, la première fois
  if (backfill) {
    state.activity = {};
    for (const s of Object.values(state.sessions)) {
      for (const thread of [s, ...Object.values(s.agents)]) {
        for (const ev of thread.events) {
          if (ev.kind === 'tool') countActivity('tools', ev.at);
          else if (ev.kind === 'prompt') countActivity('prompts', ev.at);
        }
      }
    }
  }
  for (const s of Object.values(state.sessions).sort((a, b) => a.startedAt - b.startedAt)) {
    s.number ??= nextNumber(s.host, s.cwd);
    s.name ??= null;
    for (const a of Object.values(s.agents).sort((x, y) => x.startedAt - y.startedAt)) {
      if (a.number == null) {
        s.agentSeq = (s.agentSeq ?? 0) + 1;
        a.number = s.agentSeq;
      }
    }
  }
  // État écrit avant l'historique des durées : on le reconstruit à partir des sessions conservées
  if (migrate) {
    for (const s of Object.values(state.sessions)) {
      for (const a of Object.values(s.agents)) if (a.status === 'done') recordAgent(s, a, a.endedAt ?? s.lastSeen);
      for (const t of Object.values(s.tasks ?? {})) if (t.completedAt) setTaskStatus(s, t, 'completed', t.completedAt);
    }
  }
  setInterval(autoCleanup, 60e3).unref();
  autoCleanup();
  server.listen(PORT, () => console.log(`agents listening on :${PORT}`));
})();
