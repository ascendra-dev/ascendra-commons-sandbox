/** `--name value` / `--flag` parsing for the CLI commands — nothing more is needed. */
export function parseArgs(argv: string[], spec: Record<string, 'number' | 'string' | 'boolean'>) {
  const out: Record<string, number | string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    const type = spec[name];
    if (!argv[i].startsWith('--') || !type) throw new Error(`Unknown argument: ${argv[i]} (expected: ${Object.keys(spec).map((k) => `--${k}`).join(', ')})`);
    if (type === 'boolean') { out[name] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
      out[name] = n;
    } else out[name] = value;
  }
  return out;
}
