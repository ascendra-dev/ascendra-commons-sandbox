#!/usr/bin/env node
/**
 * Re-vendors the ascendra-commons packages listed in commons.manifest.json into src/ascendra-commons/.
 *
 *   node scripts/commons-update.js [--yes] [--from <path to a local ascendra-commons checkout>]
 *
 * Source: the manifest's GitHub repo (default branch, shallow clone) — or, with --from, a local checkout, so
 * unpushed ascendra-commons work can be tried here before it's pushed. Each listed package folder is deleted and
 * replaced wholesale (files removed upstream disappear here too), keeping the <pattern>/<package> layout the
 * packages' relative imports rely on. Writes src/ascendra-commons/VENDORED.json with the source and commit, so a
 * sync can always be traced back.
 *
 * Prompts before replacing anything; --yes skips the prompt (and is required with no TTY).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const TARGET_ROOT = path.join(ROOT, 'src', 'ascendra-commons');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'commons.manifest.json'), 'utf8'));

function parseArgs(argv) {
  const args = { yes: false, from: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--yes' || argv[i] === '-y') args.yes = true;
    else if (argv[i] === '--from') args.from = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.from === undefined) throw new Error('--from needs a path');
  return args;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim().toLowerCase()); }));
}

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, stdio: 'pipe' }).toString().trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const localSource = args.from ? path.resolve(args.from) : null;

  console.log(`Source: ${localSource ?? manifest.source}${localSource ? ' (local checkout)' : ' (default branch)'}`);
  console.log(`This will DELETE AND REPLACE these folders under ${path.relative(ROOT, TARGET_ROOT)}/:`);
  for (const pkg of manifest.packages) console.log(`  ${pkg}`);
  console.log('');

  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error('Non-interactive input — pass --yes to run without a confirmation prompt. Aborting.');
      process.exit(1);
    }
    const answer = await ask('Continue? [y/N]: ');
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted — nothing was changed.');
      process.exit(0);
    }
  }

  let sourceRoot = localSource;
  let tmpDir = null;
  try {
    if (!sourceRoot) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascendra-commons-'));
      execSync(`git clone --depth 1 "${manifest.source}" "${tmpDir}"`, { stdio: 'inherit' });
      sourceRoot = tmpDir;
    }

    const missing = manifest.packages.filter((pkg) => !fs.existsSync(path.join(sourceRoot, pkg)));
    if (missing.length) throw new Error(`Not found in the source: ${missing.join(', ')}`);

    for (const pkg of manifest.packages) {
      const target = path.join(TARGET_ROOT, pkg);
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(sourceRoot, pkg), target, { recursive: true });
      console.log(`  ✓ ${pkg}`);
    }

    // Drop pattern folders no longer in the manifest's packages, so a removed package doesn't linger.
    const keptPatterns = new Set(manifest.packages.map((pkg) => pkg.split('/')[0]));
    for (const pattern of fs.readdirSync(TARGET_ROOT, { withFileTypes: true })) {
      if (!pattern.isDirectory()) continue;
      if (!keptPatterns.has(pattern.name)) {
        fs.rmSync(path.join(TARGET_ROOT, pattern.name), { recursive: true, force: true });
        console.log(`  ✗ removed ${pattern.name}/ (not in the manifest)`);
        continue;
      }
      const keptPackages = new Set(manifest.packages.filter((p) => p.startsWith(`${pattern.name}/`)).map((p) => p.split('/')[1]));
      for (const pkg of fs.readdirSync(path.join(TARGET_ROOT, pattern.name), { withFileTypes: true })) {
        if (pkg.isDirectory() && !keptPackages.has(pkg.name)) {
          fs.rmSync(path.join(TARGET_ROOT, pattern.name, pkg.name), { recursive: true, force: true });
          console.log(`  ✗ removed ${pattern.name}/${pkg.name}/ (not in the manifest)`);
        }
      }
    }

    const record = {
      source: localSource ?? manifest.source,
      commit: git(sourceRoot, 'rev-parse HEAD'),
      // A local checkout may carry uncommitted work — say so, since the commit alone wouldn't reproduce it.
      uncommittedChanges: localSource ? git(sourceRoot, 'status --porcelain').length > 0 : false,
      syncedAt: new Date().toISOString(),
      packages: manifest.packages,
    };
    fs.writeFileSync(path.join(TARGET_ROOT, 'VENDORED.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(`\n✓ Done — ${record.commit.slice(0, 7)}${record.uncommittedChanges ? ' + uncommitted changes' : ''}.`);
    console.log('  Review the diff, then run db:reset if a migration changed.');
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
