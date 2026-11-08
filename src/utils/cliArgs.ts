import { parseArgs as nodeParseArgs } from 'node:util';

export interface ParsedCliArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  multiFlags: Record<string, string[]>;
  error?: string;
}

const BOOLEAN_OPTIONS: Record<string, { short?: string }> = {
  json: {},
  force: { short: 'f' },
  foreground: {},
  all: { short: 'a' },
  yes: { short: 'y' },
  help: { short: 'h' },
  version: { short: 'v' },
  debug: {},
  quiet: {},
  'no-mcp': {},
  proxy: {},
  'no-proxy': {},
  'include-plans': {},
  includePlans: {},
  'include-plan': {},
  includePlan: {},
  'include-raw': {},
  includeRaw: {},
  'include-completed': {},
  includeCompleted: {},
  compact: {},
  raw: {},
  blocked: {},
  'no-blocked': {},
  leased: {},
  'no-leased': {},
  'in-dev': {},
  'no-in-dev': {},
  hub: {},
  pull: {},
  push: {},
};

const STRING_OPTIONS: Record<string, { short?: string }> = {
  project: { short: 'p' },
  priority: { short: 'P' },
  type: { short: 't' },
  category: { short: 'c' },
  milestone: { short: 'm' },
  name: { short: 'n' },
  status: { short: 's' },
  search: { short: 'q' },
  relation: { short: 'r' },
  description: { short: 'd' },
  desc: {},
  complexity: { short: 'x' },
  effort: { short: 'e' },
  title: {},
  summary: {},
  detail: {},
  file: {},
  plan: {},
  'plan-file': {},
  planFile: {},
  set: {},
  flag: {},
  'feature-flag': {},
  'last-hash': {},
  hash: {},
  author: {},
  by: {},
  holder: {},
  'worker-id': {},
  workerId: {},
  'leased-by': {},
  leasedBy: {},
  agent: {},
  'agent-type': {},
  system: {},
  session: {},
  'session-id': {},
  branch: {},
  worktree: {},
  workspace: {},
  ttl: {},
  notes: {},
  note: {},
  text: {},
  content: {},
  comment: {},
  message: {},
  to: {},
  'linked-to': {},
  linkedTo: {},
  link: {},
  links: {},
  'target-date': {},
  date: {},
  allow: {},
  'data-dir': {},
  host: {},
  port: {},
  lines: {},
  'final-status': {},
  finalStatus: {},
};

const SHORT_TO_LONG: Record<string, string> = {};
for (const [longName, cfg] of Object.entries({ ...BOOLEAN_OPTIONS, ...STRING_OPTIONS })) {
  if (cfg.short) {
    SHORT_TO_LONG[cfg.short] = longName;
  }
}

const KNOWN_LONG_FLAGS = new Set<string>([
  ...Object.keys(BOOLEAN_OPTIONS),
  ...Object.keys(STRING_OPTIONS),
]);

const KNOWN_SHORT_FLAGS = new Set<string>(Object.keys(SHORT_TO_LONG));

function isKnownFlagToken(val: string): boolean {
  if (!val.startsWith('-') || val === '-' || val === '--') return false;
  if (val.startsWith('--')) {
    const eqIdx = val.indexOf('=');
    const name = eqIdx > 0 ? val.slice(2, eqIdx) : val.slice(2);
    return KNOWN_LONG_FLAGS.has(name);
  }
  const eqIdx = val.indexOf('=');
  const shortName = eqIdx > 0 ? val.slice(1, eqIdx) : val.slice(1);
  return KNOWN_SHORT_FLAGS.has(shortName);
}

function parseExplicitBooleanLiteral(val: string): boolean | undefined {
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return undefined;
}

const MULTI_WORD_STRING_FLAGS = new Set<string>([
  '--title',
  '--effort',
  '-e',
  '--summary',
  '--detail',
  '--plan',
  '--set',
  '--notes',
  '--note',
  '--text',
  '--description',
  '-d',
  '--desc',
  '--name',
  '-n',
  '--search',
  '-q',
  '--author',
  '--by',
  '--status',
  '-s',
]);

function getRequiredPositionalsBeforeMultiWordFlags(
  command: string,
  positionalsSoFar: string[]
): number {
  const cmd = command.toLowerCase();
  if (
    !cmd ||
    cmd === 'create' ||
    cmd === 'new' ||
    cmd === 'add' ||
    cmd === 'list' ||
    cmd === 'ls' ||
    cmd === 'status' ||
    cmd === 'start' ||
    cmd === 'stop' ||
    cmd === 'logs' ||
    cmd === 'sync' ||
    cmd === 'snapshot' ||
    cmd === 'refresh' ||
    cmd === 'doctor' ||
    cmd === 'init' ||
    cmd === 'upgrade' ||
    cmd === 'configure' ||
    cmd === 'config' ||
    cmd === 'mcp' ||
    cmd === 'version' ||
    cmd === 'help'
  ) {
    return 0;
  }
  if (cmd === 'milestone' || cmd === 'milestones' || cmd === 'ms') {
    const sub = (positionalsSoFar[0] || '').toLowerCase();
    if (sub === 'create' || sub === 'add' || sub === 'new' || sub === 'list' || sub === 'ls') {
      return 1;
    }
    return 2;
  }
  if (cmd === 'lease' || cmd === 'leases') {
    const sub = (positionalsSoFar[0] || '').toLowerCase();
    if (sub === 'list' || sub === 'ls') {
      return 1;
    }
    return 2;
  }
  if (cmd === 'project') {
    const sub = (positionalsSoFar[0] || '').toLowerCase();
    if (sub === 'set' || sub === 'update') {
      return 2;
    }
    return 1;
  }
  if (cmd === 'rename-project' || cmd === 'unlink') {
    return 2;
  }
  if (cmd === 'link') {
    return 3;
  }
  return 1;
}

function preprocessCliArgs(rawArgs: string[]): string[] {
  const sanitized = rawArgs.map((arg) => {
    const trimmedCr = typeof arg === 'string' ? arg.replace(/\r+$/, '') : String(arg);
    if (trimmedCr === '-json') return '--json';
    if (trimmedCr.toLowerCase().startsWith('-json=')) return `-${trimmedCr}`;
    return trimmedCr;
  });

  const out: string[] = [];
  let command = '';
  const positionalsSoFar: string[] = [];

  for (let i = 0; i < sanitized.length; i++) {
    const tok = sanitized[i];

    if (
      MULTI_WORD_STRING_FLAGS.has(tok) &&
      !(command.toLowerCase() === 'sync' && (tok === '--status' || tok === '-s')) &&
      i + 1 < sanitized.length
    ) {
      const firstVal = sanitized[i + 1];
      if (!isKnownFlagToken(firstVal)) {
        out.push(tok);
        const parts: string[] = [firstVal];
        i++;

        const isStatusTwoWord =
          (tok === '--status' || tok === '-s') &&
          firstVal.toLowerCase() === 'in' &&
          i + 1 < sanitized.length &&
          /^(development|progress|dev)$/i.test(sanitized[i + 1]);

        const requiredPos = getRequiredPositionalsBeforeMultiWordFlags(command, positionalsSoFar);
        const canConsumeMultiWord = positionalsSoFar.length >= requiredPos || isStatusTwoWord;

        if (canConsumeMultiWord) {
          while (i + 1 < sanitized.length) {
            const nextTok = sanitized[i + 1];
            if (isKnownFlagToken(nextTok)) break;
            if (/^--[a-zA-Z0-9][-a-zA-Z0-9]*(=|$)/.test(nextTok)) break;
            if (
              command.toLowerCase() === 'init' &&
              (nextTok.includes('/') || nextTok.includes('\\') || nextTok.startsWith('.'))
            ) {
              break;
            }
            parts.push(nextTok);
            i++;
            if (isStatusTwoWord && positionalsSoFar.length < requiredPos) {
              break;
            }
          }
        }

        out.push(parts.join(' '));
        continue;
      }
    }

    if (isKnownFlagToken(tok)) {
      out.push(tok);
      const isStringFlag = (() => {
        if (tok.includes('=')) return false;
        const name = tok.startsWith('--') ? tok.slice(2) : SHORT_TO_LONG[tok.slice(1)];
        if (command.toLowerCase() === 'sync' && name === 'status') return false;
        return Boolean(name && name in STRING_OPTIONS);
      })();
      if (isStringFlag && i + 1 < sanitized.length && !isKnownFlagToken(sanitized[i + 1])) {
        out.push(sanitized[i + 1]);
        i++;
      }
      continue;
    }

    if (!tok.startsWith('-') || tok === '-') {
      if (!command) {
        command = tok;
      } else {
        positionalsSoFar.push(tok);
      }
    }
    out.push(tok);
  }

  return out;
}

/**
 * Standard CLI argument parser built on Node's `node:util` `parseArgs`.
 * Properly distinguishes boolean flags from value-taking string flags, supports
 * `--key=value` and `-k=value`, handles boolean flags before positionals,
 * supports `--in-dev false` / `--leased false` / `--blocked false`, detects
 * missing values for value-taking flags, and reassembles unquoted multi-word
 * string flags when shell quote-stripping occurs over SSH `cmd.exe /c`.
 */
export function parseCliArgs(rawArgs: string[]): ParsedCliArgs {
  const normalizedArgs = preprocessCliArgs(rawArgs);
  const optionsConfig: Record<string, { type: 'boolean' | 'string'; short?: string; multiple?: boolean }> = {};

  for (const [name, cfg] of Object.entries(BOOLEAN_OPTIONS)) {
    optionsConfig[name] = { type: 'boolean', ...(cfg.short ? { short: cfg.short } : {}) };
  }
  for (const [name, cfg] of Object.entries(STRING_OPTIONS)) {
    optionsConfig[name] = {
      type: 'string',
      multiple: true,
      ...(cfg.short ? { short: cfg.short } : {}),
    };
  }

  const firstNonFlag = normalizedArgs.find((a) => !a.startsWith('-') && a !== '');
  const isSyncCommand = Boolean(firstNonFlag && firstNonFlag.toLowerCase() === 'sync');
  if (isSyncCommand) {
    optionsConfig['status'] = { type: 'boolean', short: 's' };
  }

  const parsed = nodeParseArgs({
    args: normalizedArgs,
    options: optionsConfig,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const tokens = parsed.tokens || [];
  const flags: Record<string, string | boolean> = {};
  const multiFlags: Record<string, string[]> = {};
  const positionals: string[] = [];
  let command = '';
  let error: string | undefined;

  const recordStringFlag = (name: string, rawName: string | undefined, value: string) => {
    flags[name] = value;
    if (!multiFlags[name]) multiFlags[name] = [];
    multiFlags[name].push(value);

    const shortKey = STRING_OPTIONS[name]?.short;
    if (shortKey) {
      flags[shortKey] = value;
      if (!multiFlags[shortKey]) multiFlags[shortKey] = [];
      multiFlags[shortKey].push(value);
    }
    if (rawName && rawName.startsWith('-') && !rawName.startsWith('--')) {
      const sKey = rawName.slice(1).split('=')[0];
      if (sKey) {
        flags[sKey] = value;
      }
    }
  };

  const recordBooleanFlag = (name: string, rawName: string | undefined, value: boolean) => {
    if (name === 'no-in-dev') {
      flags['no-in-dev'] = value;
      flags['in-dev'] = !value;
      return;
    }
    if (name === 'no-leased') {
      flags['no-leased'] = value;
      flags['leased'] = !value;
      return;
    }
    if (name === 'no-blocked') {
      flags['no-blocked'] = value;
      flags['blocked'] = !value;
      return;
    }
    flags[name] = value;
    const shortKey = BOOLEAN_OPTIONS[name]?.short;
    if (shortKey) {
      flags[shortKey] = value;
    }
    if (name === 'force') {
      if (flags['foreground'] === undefined) flags['foreground'] = value;
    }
    if (rawName && rawName.startsWith('-') && !rawName.startsWith('--')) {
      const sKey = rawName.slice(1).split('=')[0];
      if (sKey) {
        flags[sKey] = value;
      }
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as any;
    if (token.kind === 'option-terminator') {
      for (let j = i + 1; j < tokens.length; j++) {
        const rem = tokens[j] as any;
        if (rem.value !== undefined) {
          const remVal = String(rem.value);
          if (remVal === '--json' || remVal === '-json') {
            recordBooleanFlag('json', remVal, true);
            continue;
          }
          if (!command) {
            command = remVal;
          } else {
            positionals.push(remVal);
          }
        }
      }
      break;
    }

    if (token.kind === 'positional') {
      const val = String(token.value);
      if (!command) {
        command = val;
      } else {
        positionals.push(val);
      }
      continue;
    }

    if (token.kind === 'option') {
      const name: string = token.name;
      const rawName: string = token.rawName || `--${name}`;

      // Dual-mode option: --hub can be boolean (`ese init --hub`) or take a path/name (`ese init --project P --hub my-hub`)
      if (name === 'hub') {
        if (token.inlineValue && token.value !== undefined) {
          flags['hub'] = String(token.value);
        } else if (
          i + 1 < tokens.length &&
          tokens[i + 1].kind === 'positional' &&
          !String((tokens[i + 1] as any).value).startsWith('-')
        ) {
          const nextVal = String((tokens[i + 1] as any).value);
          flags['hub'] = nextVal;
          i++;
        } else {
          flags['hub'] = true;
        }
        continue;
      }

      if (name in BOOLEAN_OPTIONS || (isSyncCommand && name === 'status')) {
        if (token.inlineValue && token.value !== undefined) {
          const parsedBool = parseExplicitBooleanLiteral(String(token.value));
          if (parsedBool === undefined) {
            error = error || `Invalid boolean value '${token.value}' for flag ${rawName}. Expected true or false.`;
            recordBooleanFlag(name, rawName, Boolean(token.value));
          } else {
            recordBooleanFlag(name, rawName, parsedBool);
          }
        } else if (i + 1 < tokens.length && tokens[i + 1].kind === 'positional') {
          const candidate = String((tokens[i + 1] as any).value);
          const parsedBool =
            candidate.trim().toLowerCase() === 'true'
              ? true
              : candidate.trim().toLowerCase() === 'false'
                ? false
                : undefined;
          if (parsedBool !== undefined) {
            recordBooleanFlag(name, rawName, parsedBool);
            i++;
          } else {
            recordBooleanFlag(name, rawName, true);
          }
        } else {
          recordBooleanFlag(name, rawName, true);
        }
        continue;
      }

      if (name in STRING_OPTIONS) {
        if (
          token.value === undefined ||
          (!token.inlineValue && typeof token.value === 'string' && isKnownFlagToken(token.value))
        ) {
          error = error || `Flag ${rawName} requires a value.`;
          continue;
        }
        let strVal = String(token.value);
        if (token.inlineValue && rawName.startsWith('-') && !rawName.startsWith('--') && strVal.startsWith('=')) {
          strVal = strVal.slice(1);
        }
        recordStringFlag(name, rawName, strVal);
        continue;
      }

      // Unknown option fallback (with strict: false)
      if (token.inlineValue && token.value !== undefined) {
        let strVal = String(token.value);
        if (token.inlineValue && rawName.startsWith('-') && !rawName.startsWith('--') && strVal.startsWith('=')) {
          strVal = strVal.slice(1);
        }
        recordStringFlag(name, rawName, strVal);
      } else if (
        i + 1 < tokens.length &&
        tokens[i + 1].kind === 'positional' &&
        !String((tokens[i + 1] as any).value).startsWith('-')
      ) {
        const nextVal = String((tokens[i + 1] as any).value);
        recordStringFlag(name, rawName, nextVal);
        i++;
      } else {
        recordBooleanFlag(name, rawName, true);
      }
    }
  }

  // Canonical shorthand & alias synchronization
  if (flags['t'] !== undefined && flags['type'] === undefined) flags['type'] = flags['t'];
  if (flags['c'] !== undefined && flags['category'] === undefined) flags['category'] = flags['c'];
  if (flags['p'] !== undefined && flags['project'] === undefined) flags['project'] = flags['p'];
  if (flags['P'] !== undefined && flags['priority'] === undefined) flags['priority'] = flags['P'];
  if (flags['m'] !== undefined && flags['milestone'] === undefined) flags['milestone'] = flags['m'];
  if (flags['n'] !== undefined && flags['name'] === undefined) flags['name'] = flags['n'];
  if (flags['s'] !== undefined && flags['status'] === undefined) flags['status'] = flags['s'];
  if (flags['q'] !== undefined && flags['search'] === undefined) flags['search'] = flags['q'];
  if (flags['r'] !== undefined && flags['relation'] === undefined) flags['relation'] = flags['r'];
  if (flags['d'] !== undefined && flags['description'] === undefined) flags['description'] = flags['d'];
  if (flags['x'] !== undefined && flags['complexity'] === undefined) flags['complexity'] = flags['x'];
  if (flags['e'] !== undefined && flags['effort'] === undefined) flags['effort'] = flags['e'];
  if (flags['f'] !== undefined && flags['foreground'] === undefined) flags['foreground'] = flags['f'];
  if (flags['f'] !== undefined && flags['force'] === undefined) flags['force'] = flags['f'];
  if (flags['a'] !== undefined && flags['all'] === undefined) flags['all'] = flags['a'];
  if (flags['y'] !== undefined && flags['yes'] === undefined) flags['yes'] = flags['y'];
  if (flags['h'] !== undefined && flags['help'] === undefined) flags['help'] = flags['h'];
  if (flags['v'] !== undefined && flags['version'] === undefined) flags['version'] = flags['v'];

  return { command, positionals, flags, multiFlags, ...(error ? { error } : {}) };
}
