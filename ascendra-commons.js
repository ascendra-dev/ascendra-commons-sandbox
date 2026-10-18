#!/usr/bin/env node
/**
 * ascendra-commons.js — installs and updates ascendra-commons packages in a consumer project.
 *
 *   node ascendra-commons.js init [--migrations drizzle-kit|folder] [--dir <path>] [--drizzle-config <file>]
 *                                 [--target <path>] [--source <git url>]
 *   node ascendra-commons.js add <package…> [--yes] [--from <path>]
 *   node ascendra-commons.js update [--yes] [--from <path>]
 *   node ascendra-commons.js remove <package> [--yes]
 *   node ascendra-commons.js status [--from <path>] [--offline]
 *
 * Run it from the consumer project's root. `init` (run once, from a checkout of ascendra-commons or a downloaded
 * copy of this file) copies the script into the project and writes `ascendra-commons.json`; `update` keeps the copy
 * current. `--from <path>` reads a local ascendra-commons checkout instead of GitHub (to try unpushed work).
 *
 * What it maintains:
 * - `ascendra-commons.json` — your choices: the source, the target folder, the packages you asked for, and how
 *   migrations reach your migration tool. `add` / `remove` edit `packages`; edit the rest by hand if needed.
 * - `<target>/VENDORED.json` — written only by this script: the commit every vendored package came from, a sha256
 *   per file (so a local edit is caught before an update overwrites it), and each migration already delivered.
 *
 * Packages are copied unchanged, except what only serves ascendra-commons' own development: tests (`*.spec.ts` — they
 * run in ascendra-commons, where the code changes) and design mocks (`mocks.html`). A package's hard dependencies
 * (other packages its code imports) are added with it. A choice between implementations (an emitter transport, an authorizer)
 * is never imported, so name it yourself — the package README's "Consuming this module" lists it.
 *
 * Migrations: each package's `migrations/NNNN_<name>.sql` is never edited once released (MODULE-STANDARD dimension 7),
 * so a file is delivered once, and an update only delivers new ones — refusing to continue if a delivered file
 * changed upstream. Delivery: `drizzle-kit` (registered via `drizzle-kit generate --custom`, then filled in) or
 * `folder` (a timestamped copy). Never re-export the vendored `*.schema.ts` tables to drizzle-kit as well.
 *
 * It never runs `npm install`, never writes your forRoot() wiring, and never touches your database — it lists the
 * npm packages you're missing and points at each package's README.
 */

const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { builtinModules } = require('module');

const SCRIPT_NAME = 'ascendra-commons.js';
const CONFIG_FILE = 'ascendra-commons.json';
const LOCK_FILE = 'VENDORED.json';
const DEFAULT_SOURCE = 'https://github.com/ascendra-dev/ascendra-commons.git';
const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, CONFIG_FILE);

class UserError extends Error {}

// ─── args / prompts ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [], yes: false, offline: false };
  const valued = new Set(['from', 'migrations', 'dir', 'drizzle-config', 'target', 'source']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--offline') args.offline = true;
    else if (a.startsWith('--') && valued.has(a.slice(2))) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UserError(`${a} needs a value`);
      args[a.slice(2)] = v;
    } else if (a.startsWith('-')) throw new UserError(`Unknown option: ${a}`);
    else args._.push(a);
  }
  return args;
}

async function confirm(question, args) {
  if (args.yes) return true;
  if (!process.stdin.isTTY) throw new UserError('Non-interactive input — pass --yes to run without a confirmation prompt.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N]: `, (a) => { rl.close(); resolve(a.trim().toLowerCase()); }));
  return answer === 'y' || answer === 'yes';
}

// ─── files ─────────────────────────────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Every file under `dir`, as sorted POSIX-style relative paths. */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

function hashTree(dir, files = listFiles(dir)) {
  return Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, f)))]));
}

/** Files that serve only ascendra-commons' own development — never copied into a consumer. */
const NOT_VENDORED = [/\.spec\.ts$/, /(^|\/)mocks\.html$/];

/** The files of a source package that a consumer receives. */
function vendoredFiles(dir) {
  return listFiles(dir).filter((f) => !NOT_VENDORED.some((re) => re.test(f)));
}

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// ─── config / lock ─────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new UserError(`No ${CONFIG_FILE} here — run \`node ${SCRIPT_NAME} init\` from the project root first.`);
  const config = readJson(CONFIG_PATH);
  config.packages ??= [];
  return config;
}

function targetDir(config) {
  return path.join(ROOT, config.target);
}

function loadLock(config) {
  const file = path.join(targetDir(config), LOCK_FILE);
  if (!fs.existsSync(file)) return { packages: {}, migrations: {} };
  const lock = readJson(file);
  lock.packages ??= {};
  lock.migrations ??= {};
  return lock;
}

function saveLock(config, lock) {
  fs.mkdirSync(targetDir(config), { recursive: true });
  writeJson(path.join(targetDir(config), LOCK_FILE), {
    $comment: `Written by ${SCRIPT_NAME} — never edit by hand. Which ascendra-commons commit each vendored package came from, a sha256 per file, and every migration already delivered.`,
    ...lock,
  });
}

// ─── source (GitHub clone or local checkout) ───────────────────────────────────

/**
 * The ascendra-commons tree to read from. Without `commit`: the default branch (GitHub) or the working tree (--from,
 * uncommitted work included). With `commit`: exactly that commit — so `add` matches what's already vendored.
 * `repo` is a git repository with history, for the commit log.
 */
function openSource(config, args, commit) {
  const from = args.from ? path.resolve(args.from) : null;
  const cleanups = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ascendra-commons-'));
    cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
    return d;
  };
  try {
    let repo, root, label;
    if (from) {
      if (!fs.existsSync(path.join(from, SCRIPT_NAME))) throw new UserError(`${from} doesn't look like an ascendra-commons checkout (no ${SCRIPT_NAME}).`);
      repo = from;
      label = `${from} (local checkout)`;
    } else {
      const source = config.source ?? DEFAULT_SOURCE;
      repo = tmp();
      console.log(`Fetching ${source} …`);
      execFileSync('git', ['clone', '--quiet', '--filter=blob:none', source, repo], { stdio: ['ignore', 'ignore', 'inherit'] });
      label = source;
    }
    const head = git(repo, 'rev-parse', 'HEAD');
    let uncommitted = false;
    if (commit && commit !== head) {
      try { git(repo, 'cat-file', '-e', `${commit}^{commit}`); } catch {
        throw new UserError(`Commit ${commit.slice(0, 7)} (what's vendored now) isn't in ${label} — run update instead.`);
      }
      root = tmp();
      execSync(`git archive ${commit} | tar -x -C "${root}"`, { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
    } else {
      root = repo;
      uncommitted = Boolean(from) && git(repo, 'status', '--porcelain').length > 0;
    }
    return { root, repo, commit: commit ?? head, uncommitted, label, close: () => cleanups.forEach((c) => c()) };
  } catch (err) {
    cleanups.forEach((c) => c());
    throw err;
  }
}

// ─── packages & dependencies ───────────────────────────────────────────────────

/**
 * A package is `<pattern>/<package>` (a dot-named sub-folder) — or, for a pattern with no sub-folders
 * (`localization-currency`), the pattern folder itself.
 */
function isPackage(root, id) {
  const dir = path.join(root, id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const segments = id.split('/');
  if (segments.length === 2) return true;
  return segments.length === 1 && !fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());
}

/** `audit-logging.core` → `audit-logging/audit-logging.core`; `audit-logging/audit-logging.core` and `soft-delete` as-is. */
function normalizeId(root, arg) {
  const clean = arg.replace(/\/+$/, '');
  const candidates = clean.includes('/') ? [clean] : [`${clean.split('.')[0]}/${clean}`, clean];
  const id = candidates.find((c) => isPackage(root, c));
  if (id) return id;
  if (fs.existsSync(path.join(root, clean)) && !clean.includes('/')) {
    const subs = fs.readdirSync(path.join(root, clean), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${clean}/${e.name}`);
    throw new UserError(`${clean} is a pattern with several packages — name the ones you need:\n  ${subs.join('\n  ')}`);
  }
  throw new UserError(`No package ${arg} in ascendra-commons.`);
}

function packageOf(root, absPath) {
  const segments = path.relative(root, absPath).split(path.sep);
  if (segments[0] === '..') return null;
  if (segments.length >= 2 && isPackage(root, `${segments[0]}/${segments[1]}`)) return `${segments[0]}/${segments[1]}`;
  if (isPackage(root, segments[0])) return segments[0];
  return null;
}

const IMPORT_RE = /^\s*(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * Every import in a package's `.ts` files: `{ file, specifier, isSpec }`, plus — for a relative import that lands in
 * another package — `target` (that package) and `entry` (whether it imports the package root, i.e. its index.ts).
 */
function importsOf(root, id) {
  const out = [];
  for (const rel of listFiles(path.join(root, id)).filter((f) => f.endsWith('.ts'))) {
    const file = path.join(root, id, rel);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const specifier = m[1] ?? m[2] ?? m[3];
      const entry = { file: `${id}/${rel}`, specifier, isSpec: rel.endsWith('.spec.ts') };
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), specifier);
        const target = packageOf(root, resolved);
        if (target && target !== id) {
          entry.target = target;
          entry.entry = [path.join(root, target), path.join(root, target, 'index')].includes(resolved.replace(/\.(ts|js)$/, ''));
        }
      }
      out.push(entry);
    }
  }
  return out;
}

/** What a package's code (tests aside — they aren't vendored) imports: other packages (`hard`) and npm packages. */
function scanImports(root, id) {
  const hard = new Set();
  const npm = new Set();
  const builtins = new Set(builtinModules);
  for (const { specifier, isSpec, target } of importsOf(root, id)) {
    if (isSpec) continue;
    if (target) hard.add(target);
    else if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (!builtins.has(name)) npm.add(name);
    }
  }
  return { hard, npm };
}

/** The packages asked for plus every hard dependency, transitively — `id → [what pulled it in]` (empty = asked for). */
function resolveClosure(root, requested) {
  const closure = new Map(requested.map((id) => [id, []]));
  const queue = [...requested];
  while (queue.length) {
    const id = queue.shift();
    if (!isPackage(root, id)) throw new UserError(`${id} is no longer in ascendra-commons (renamed or removed upstream) — update ${CONFIG_FILE}.`);
    for (const dep of scanImports(root, id).hard) {
      if (!closure.has(dep)) { closure.set(dep, [id]); queue.push(dep); }
      else if (closure.get(dep).length && !closure.get(dep).includes(id)) closure.get(dep).push(id);
    }
  }
  return closure;
}

/** Dependencies first, so migrations run in an order that satisfies cross-package references. */
function dependencyOrder(root, ids) {
  const set = new Set(ids);
  const done = new Set();
  const out = [];
  const visit = (id) => {
    if (done.has(id)) return;
    done.add(id);
    for (const dep of scanImports(root, id).hard) if (set.has(dep)) visit(dep);
    out.push(id);
  };
  [...ids].sort().forEach(visit);
  return out;
}

function missingNpm(root, ids) {
  const pkgFile = path.join(ROOT, 'package.json');
  const own = fs.existsSync(pkgFile) ? readJson(pkgFile) : {};
  const have = new Set(Object.keys({ ...own.dependencies, ...own.devDependencies, ...own.peerDependencies }));
  const commonsPkg = fs.existsSync(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : {};
  const versions = { ...commonsPkg.devDependencies, ...commonsPkg.dependencies };
  const needed = new Map();
  for (const id of ids) for (const name of scanImports(root, id).npm) if (!have.has(name)) needed.set(name, versions[name] ?? '');
  return needed;
}

function reportMissingNpm(root, ids) {
  const npm = missingNpm(root, ids);
  if (!npm.size) return;
  console.log('\nnpm packages the vendored code imports that package.json lacks — install them yourself:');
  for (const [name, version] of npm) console.log(`  ${name}${version ? `@${version}` : ''}`);
}

// ─── migrations ────────────────────────────────────────────────────────────────

function migrationFiles(root, id) {
  const dir = path.join(root, id, 'migrations');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort() : [];
}

/** `commons_audit-logging_0001_audit_event` → sanitized; the full package id only if a sibling package also ships migrations. */
function migrationName(root, id, file, allIds) {
  const pattern = id.split('/')[0];
  const sibling = allIds.some((other) => other !== id && other.split('/')[0] === pattern && migrationFiles(root, other).length);
  const base = sibling ? id.replace('/', '_') : pattern;
  return `commons_${base}_${file.replace(/\.sql$/, '')}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function timestamp(offsetSeconds) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Delivers `pending` ([{ id, file }]) into the project's migrations, and records each in `lock.migrations`. */
function deliverMigrations(config, source, pending, lock, allIds) {
  if (!pending.length) return;
  const m = config.migrations;
  if (!m || !m.tool) throw new UserError(`${CONFIG_FILE} has no "migrations" setting — see \`node ${SCRIPT_NAME} init\`.`);
  const dir = path.join(ROOT, m.dir);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\nMigrations → ${m.dir} (${m.tool}):`);
  pending.forEach(({ id, file }, i) => {
    const sql = fs.readFileSync(path.join(source.root, id, 'migrations', file));
    const header = `-- From ascendra-commons ${id}/migrations/${file} @ ${source.commit.slice(0, 7)}.\n-- Never edit: ${config.target}/${LOCK_FILE} holds its checksum; a schema change arrives as a new file.\n\n`;
    const name = migrationName(source.root, id, file, allIds);
    let written;
    if (m.tool === 'folder') {
      written = path.join(dir, `${timestamp(i)}_${name}.sql`);
    } else if (m.tool === 'drizzle-kit') {
      const before = new Set(fs.readdirSync(dir));
      const cmd = ['drizzle-kit', 'generate', '--custom', `--name=${name}`, ...(m.drizzleConfig ? [`--config=${m.drizzleConfig}`] : [])];
      execFileSync('npx', cmd, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
      const created = fs.readdirSync(dir).filter((f) => !before.has(f) && f.endsWith('.sql'));
      if (created.length !== 1) throw new UserError(`drizzle-kit didn't create exactly one file in ${m.dir} (got ${created.length}) — is "dir" its "out" folder?`);
      written = path.join(dir, created[0]);
    } else {
      throw new UserError(`Unknown migrations tool "${m.tool}" in ${CONFIG_FILE} — use "drizzle-kit" or "folder".`);
    }
    fs.writeFileSync(written, Buffer.concat([Buffer.from(header), sql]));
    lock.migrations[`${id}/${file}`] = { checksum: sha256(sql), copiedTo: path.relative(ROOT, written).split(path.sep).join('/') };
    console.log(`  ✓ ${id}/${file} → ${path.relative(ROOT, written)}`);
  });
  console.log('  Apply them with your migration tool.');
}

function pendingMigrations(root, ids, lock) {
  return dependencyOrder(root, ids).flatMap((id) => migrationFiles(root, id)
    .filter((file) => !lock.migrations[`${id}/${file}`])
    .map((file) => ({ id, file })));
}

/** A delivered migration must never change upstream — the consumer's database has already run it. */
function changedReleasedMigrations(root, lock, ids) {
  const problems = [];
  for (const [key, entry] of Object.entries(lock.migrations)) {
    const id = key.slice(0, key.lastIndexOf('/')); // keys are `<package id>/<file>`
    if (!ids.includes(id)) continue; // a removed package's record — kept so a re-add never delivers twice
    const file = path.join(root, id, 'migrations', path.basename(key));
    if (!fs.existsSync(file)) problems.push(`${key} — deleted upstream`);
    else if (sha256(fs.readFileSync(file)) !== entry.checksum) problems.push(`${key} — edited upstream`);
  }
  return problems;
}

// ─── vendoring ─────────────────────────────────────────────────────────────────

function localEdits(config, lock) {
  const edits = [];
  for (const [id, entry] of Object.entries(lock.packages)) {
    const actual = hashTree(path.join(targetDir(config), id));
    for (const [file, hash] of Object.entries(entry.files)) {
      if (!(file in actual)) edits.push(`${id}/${file} (deleted)`);
      else if (actual[file] !== hash) edits.push(`${id}/${file} (edited)`);
    }
    for (const file of Object.keys(actual)) if (!(file in entry.files)) edits.push(`${id}/${file} (added)`);
  }
  return edits;
}

function copyPackage(config, source, id) {
  const dest = path.join(targetDir(config), id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const file of vendoredFiles(path.join(source.root, id))) {
    fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true });
    fs.copyFileSync(path.join(source.root, id, file), path.join(dest, file));
  }
  return hashTree(dest);
}

function deletePackage(config, id) {
  fs.rmSync(path.join(targetDir(config), id), { recursive: true, force: true });
  const pattern = path.join(targetDir(config), id.split('/')[0]);
  if (id.includes('/') && fs.existsSync(pattern) && fs.readdirSync(pattern).length === 0) fs.rmdirSync(pattern);
}

function lockEntry(files, requiredBy) {
  return requiredBy.length ? { requiredBy, files } : { files };
}

function stampLock(lock, source) {
  lock.source = source.label;
  lock.commit = source.commit;
  lock.uncommittedChanges = source.uncommitted;
  lock.syncedAt = new Date().toISOString();
}

/** Keeps the project's copy of this script current with the source's. */
function refreshScript(source) {
  const upstream = path.join(source.root, SCRIPT_NAME);
  const own = path.join(ROOT, SCRIPT_NAME);
  if (!fs.existsSync(upstream) || path.resolve(upstream) === path.resolve(own)) return;
  if (fs.existsSync(own) && sha256(fs.readFileSync(own)) === sha256(fs.readFileSync(upstream))) return;
  fs.copyFileSync(upstream, own);
  console.log(`\n✓ ${SCRIPT_NAME} updated from the source.`);
}

// ─── commands ──────────────────────────────────────────────────────────────────

function cmdInit(args) {
  if (fs.existsSync(CONFIG_PATH)) throw new UserError(`${CONFIG_FILE} already exists.`);
  const drizzleConfig = args['drizzle-config'] ?? ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs'].find((f) => fs.existsSync(path.join(ROOT, f)));
  const tool = args.migrations ?? (drizzleConfig ? 'drizzle-kit' : 'folder');
  if (!['drizzle-kit', 'folder'].includes(tool)) throw new UserError('--migrations must be drizzle-kit or folder.');
  let dir = args.dir;
  if (!dir && tool === 'drizzle-kit' && drizzleConfig) {
    dir = fs.readFileSync(path.join(ROOT, drizzleConfig), 'utf8').match(/\bout\s*:\s*['"]([^'"]+)['"]/)?.[1]?.replace(/^\.\//, '');
  }
  if (!dir) throw new UserError(`Pass --dir <your migrations folder>${tool === 'drizzle-kit' ? ` (couldn't read "out" from ${drizzleConfig ?? 'a drizzle config'})` : ''}.`);
  const config = {
    $comment: `ascendra-commons packages this project vendors — managed by ${SCRIPT_NAME} (add / remove edit "packages").`,
    source: args.source ?? DEFAULT_SOURCE,
    target: args.target ?? 'src/ascendra-commons',
    migrations: { tool, dir, ...(tool === 'drizzle-kit' && drizzleConfig ? { drizzleConfig } : {}) },
    packages: [],
  };
  writeJson(CONFIG_PATH, config);
  console.log(`✓ Wrote ${CONFIG_FILE}: target ${config.target}, migrations via ${tool} into ${dir}.`);
  const own = path.join(ROOT, SCRIPT_NAME);
  if (path.resolve(__filename) !== path.resolve(own)) {
    fs.copyFileSync(__filename, own);
    console.log(`✓ Copied ${SCRIPT_NAME} into the project — run it from here from now on.`);
  }
  console.log(`\nNext: node ${SCRIPT_NAME} add <package…>`);
}

async function cmdAdd(args) {
  const config = loadConfig();
  const lock = loadLock(config);
  if (!args._.length) throw new UserError('Name at least one package, e.g. add audit-logging/audit-logging.core.postgres-drizzle');
  // Match what's already vendored, so the project never mixes commons versions — moving forward is update's job.
  const pin = Object.keys(lock.packages).length && !lock.uncommittedChanges ? lock.commit : undefined;
  const source = openSource(config, args, pin);
  try {
    const requested = args._.map((a) => normalizeId(source.root, a));
    const explicit = [...new Set([...config.packages, ...requested])];
    const closure = resolveClosure(source.root, explicit);
    const fresh = [...closure.keys()].filter((id) => !lock.packages[id]);
    if (!fresh.length) {
      console.log('Already vendored — nothing to add.');
      config.packages = explicit;
      writeJson(CONFIG_PATH, config);
      return;
    }
    for (const id of fresh) {
      if (fs.existsSync(path.join(targetDir(config), id))) throw new UserError(`${config.target}/${id} exists but ${LOCK_FILE} doesn't list it — move it away first (or delete it if it's an old manual copy).`);
    }
    console.log(`Source: ${source.label} @ ${source.commit.slice(0, 7)}${pin ? ' (the commit already vendored)' : ''}`);
    console.log(`Adding to ${config.target}/:`);
    for (const id of fresh) console.log(`  + ${id}${closure.get(id).length ? `   (needed by ${closure.get(id).join(', ')})` : ''}`);
    const pending = pendingMigrations(source.root, fresh, lock);
    if (pending.length) console.log(`  and ${pending.length} migration(s) into ${config.migrations?.dir}`);
    if (!(await confirm('Continue?', args))) return console.log('Aborted — nothing was changed.');

    for (const id of fresh) lock.packages[id] = lockEntry(copyPackage(config, source, id), closure.get(id));
    for (const [id, requiredBy] of closure) if (lock.packages[id]) lock.packages[id] = lockEntry(lock.packages[id].files, requiredBy);
    stampLock(lock, source);
    config.packages = explicit;
    deliverMigrations(config, source, pending, lock, [...closure.keys()]);
    saveLock(config, lock);
    writeJson(CONFIG_PATH, config);
    console.log(`\n✓ Added ${fresh.length} package(s).`);
    reportMissingNpm(source.root, fresh);
    console.log("\nNext: wire them up — each package's README, \"Consuming this module\" / \"Wiring\".");
  } finally {
    source.close();
  }
}

function commitLog(source, fromCommit, ids) {
  try { git(source.repo, 'cat-file', '-e', `${fromCommit}^{commit}`); } catch { return null; }
  const out = git(source.repo, 'log', '--format=%h%x1f%s%x1f%b%x1e', `${fromCommit}..${source.commit}`, '--', ...ids);
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [hash, subject, body] = r.split('\x1f');
    const footer = body?.match(/BREAKING CHANGE:\s*([\s\S]*?)(?:\n\s*\n|\nCo-Authored-By|$)/)?.[1]?.trim();
    return { hash, subject, breaking: /^\w+(\([^)]*\))?!:/.test(subject) || Boolean(footer), footer };
  });
}

async function cmdUpdate(args) {
  const config = loadConfig();
  const lock = loadLock(config);
  if (!config.packages.length) throw new UserError(`Nothing vendored yet — use add.`);
  const edits = localEdits(config, lock);
  if (edits.length) {
    throw new UserError(`Vendored files were changed locally — an update would overwrite them:\n  ${edits.join('\n  ')}\n` +
      'Make the change in ascendra-commons instead, and revert it here (git checkout) before updating.');
  }
  const source = openSource(config, args);
  try {
    const closure = resolveClosure(source.root, config.packages);
    const ids = [...closure.keys()];
    const broken = changedReleasedMigrations(source.root, lock, Object.keys(lock.packages));
    if (broken.length) {
      throw new UserError(`Migrations this project already received changed upstream — released migrations must never change:\n  ${broken.join('\n  ')}\n` +
        'Report it in ascendra-commons (the fix is a new numbered migration); nothing was changed here.');
    }

    const changes = [];
    for (const id of ids) {
      const upstream = hashTree(path.join(source.root, id), vendoredFiles(path.join(source.root, id)));
      const before = lock.packages[id]?.files;
      if (!before) { changes.push({ id, kind: 'new', note: `needed by ${closure.get(id).join(', ') || 'you'}` }); continue; }
      const changed = Object.keys(upstream).filter((f) => f in before && before[f] !== upstream[f]).length;
      const added = Object.keys(upstream).filter((f) => !(f in before)).length;
      const removed = Object.keys(before).filter((f) => !(f in upstream)).length;
      if (changed + added + removed) changes.push({ id, kind: 'changed', note: `${changed} changed, ${added} added, ${removed} removed` });
    }
    const dropped = Object.keys(lock.packages).filter((id) => !closure.has(id));
    const pending = pendingMigrations(source.root, ids, lock);
    const log = lock.commit ? commitLog(source, lock.commit, ids) : null;
    const breaking = (log ?? []).filter((c) => c.breaking);

    if (!changes.length && !dropped.length && !pending.length) {
      stampLock(lock, source);
      saveLock(config, lock);
      refreshScript(source);
      return console.log(`Already up to date (${source.commit.slice(0, 7)}).`);
    }

    console.log(`Source: ${source.label}`);
    console.log(`From ${lock.commit?.slice(0, 7) ?? '?'} to ${source.commit.slice(0, 7)}${source.uncommitted ? ' + uncommitted changes' : ''}\n`);
    if (breaking.length) {
      console.log(`⚠ ${breaking.length} BREAKING change(s) — read before continuing:`);
      for (const c of breaking) console.log(`  ${c.hash} ${c.subject}${c.footer ? `\n         → ${c.footer.replace(/\n/g, '\n           ')}` : ''}`);
      console.log('');
    }
    if (log === null) console.log("(The vendored commit isn't in the source's history — showing file changes only.)\n");
    else if (log.length) {
      console.log('Commits touching your packages:');
      for (const c of log) console.log(`  ${c.hash} ${c.subject}`);
      console.log('');
    }
    console.log('Packages:');
    for (const c of changes) console.log(`  ${c.kind === 'new' ? '+' : '~'} ${c.id}   (${c.note})`);
    for (const id of dropped) console.log(`  - ${id}   (no longer needed by ${CONFIG_FILE})`);
    if (pending.length) console.log(`\nNew migrations: ${pending.map((p) => `${p.id}/${p.file}`).join(', ')}`);
    if (!(await confirm(`\n${breaking.length ? 'Includes breaking changes. ' : ''}Replace the packages above?`, args))) return console.log('Aborted — nothing was changed.');

    for (const c of changes) lock.packages[c.id] = lockEntry(copyPackage(config, source, c.id), closure.get(c.id));
    for (const [id, requiredBy] of closure) lock.packages[id] = lockEntry(lock.packages[id].files, requiredBy);
    for (const id of dropped) { deletePackage(config, id); delete lock.packages[id]; }
    stampLock(lock, source);
    deliverMigrations(config, source, pending, lock, ids);
    saveLock(config, lock);
    console.log(`\n✓ Updated to ${source.commit.slice(0, 7)}. Review the diff${pending.length ? ', apply the new migrations' : ''}, and fix any compile errors.`);
    reportMissingNpm(source.root, changes.map((c) => c.id));
    refreshScript(source);
  } finally {
    source.close();
  }
}

async function cmdRemove(args) {
  const config = loadConfig();
  const lock = loadLock(config);
  if (args._.length !== 1) throw new UserError('Name one package to remove.');
  const root = targetDir(config);
  const id = normalizeId(root, args._[0]);
  if (!config.packages.includes(id)) {
    const by = lock.packages[id]?.requiredBy ?? [];
    throw new UserError(by.length ? `${id} wasn't added directly — it's needed by ${by.join(', ')}.` : `${id} isn't vendored.`);
  }
  const remaining = config.packages.filter((p) => p !== id);
  const keep = resolveClosure(root, remaining);
  const going = Object.keys(lock.packages).filter((p) => !keep.has(p));
  console.log('Removing:');
  for (const p of going) console.log(`  - ${p}`);
  const delivered = Object.keys(lock.migrations).filter((k) => going.some((p) => k.startsWith(`${p}/`)));
  if (delivered.length) console.log(`\nIts tables stay — ${delivered.length} delivered migration(s) are left as they are; dropping tables is your own migration.`);
  if (!(await confirm('Continue?', args))) return console.log('Aborted — nothing was changed.');
  for (const p of going) { deletePackage(config, p); delete lock.packages[p]; }
  for (const [p, requiredBy] of keep) lock.packages[p] = lockEntry(lock.packages[p].files, requiredBy);
  config.packages = remaining;
  saveLock(config, lock); // delivered migrations stay recorded, so re-adding the package never delivers them twice
  writeJson(CONFIG_PATH, config);
  console.log(`\n✓ Removed ${going.length} package(s). Remove their wiring from your modules.`);
}

function cmdStatus(args) {
  const config = loadConfig();
  const lock = loadLock(config);
  const root = targetDir(config);
  const vendored = Object.keys(lock.packages);
  let problems = 0;
  const section = (title, lines) => {
    if (!lines.length) return;
    problems += lines.length;
    console.log(`\n${title}`);
    for (const l of lines) console.log(`  ${l}`);
  };
  console.log(`${vendored.length} package(s) in ${config.target} @ ${lock.commit?.slice(0, 7) ?? '—'}${lock.uncommittedChanges ? ' + uncommitted changes' : ''} (synced ${lock.syncedAt ?? 'never'})`);

  section('Edited locally (an update refuses until these are reverted):', localEdits(config, lock));
  const missing = [];
  for (const id of vendored) for (const dep of scanImports(root, id).hard) if (!lock.packages[dep]) missing.push(`${id} needs ${dep}`);
  section('Missing dependencies:', missing);
  section('Migrations not yet delivered (run update):', pendingMigrations(root, vendored, lock).map((p) => `${p.id}/${p.file}`));
  section('npm packages missing from package.json:', [...missingNpm(root, vendored)].map(([n, v]) => `${n}${v ? `@${v}` : ''}`));

  if (!args.offline && lock.commit) {
    try {
      const head = args.from ? git(path.resolve(args.from), 'rev-parse', 'HEAD')
        : execFileSync('git', ['ls-remote', config.source ?? DEFAULT_SOURCE, 'HEAD']).toString().split(/\s/)[0];
      console.log(head === lock.commit ? '\nUp to date with the source.' : `\nThe source has moved on (${head.slice(0, 7)}) — run update to see what changed.`);
    } catch {
      console.log('\n(Could not reach the source — pass --offline to skip this check.)');
    }
  }
  if (!problems) console.log('\n✓ No problems.');
  process.exitCode = problems ? 1 : 0;
}

// ─── main ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage (from the project root):
  node ${SCRIPT_NAME} init [--migrations drizzle-kit|folder] [--dir <path>] [--drizzle-config <file>]
  node ${SCRIPT_NAME} add <package…> [--yes] [--from <path>]
  node ${SCRIPT_NAME} update [--yes] [--from <path>]
  node ${SCRIPT_NAME} remove <package> [--yes]
  node ${SCRIPT_NAME} status [--from <path>] [--offline]`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();
  if (command === 'init') return cmdInit(args);
  if (command === 'add') return cmdAdd(args);
  if (command === 'update') return cmdUpdate(args);
  if (command === 'remove') return cmdRemove(args);
  if (command === 'status') return cmdStatus(args);
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof UserError ? err.message : err.stack ?? err);
    process.exitCode = 1;
  });
}

// For this repo's own scripts/check.js — the same package and import rules `add` relies on.
module.exports = { isPackage, importsOf, listFiles, migrationFiles };
