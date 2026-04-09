export type ParsedArgs = {
  positionals: string[];
  options: Record<string, string[]>;
  flags: Set<string>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string[]> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      pushOption(options, rawKey, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      pushOption(options, rawKey, next);
      i += 1;
      continue;
    }

    flags.add(rawKey);
  }

  return { positionals, options, flags };
}

export function getOption(args: ParsedArgs, key: string): string | undefined {
  return args.options[key]?.at(0);
}

export function getOptions(args: ParsedArgs, key: string): string[] {
  return args.options[key] ?? [];
}

export function hasFlag(args: ParsedArgs, key: string): boolean {
  return args.flags.has(key);
}

export function parseKeyValue(input: string): { key: string; value: string } {
  const separatorIndex = input.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(`Invalid key=value pair: ${input}`);
  }

  return {
    key: input.slice(0, separatorIndex),
    value: input.slice(separatorIndex + 1),
  };
}

export function coerceScalar(value: string): boolean | number | null | string {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return value;
}

export function pairsToRecord(
  inputs: string[],
  coerce = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const input of inputs) {
    const { key, value } = parseKeyValue(input);
    const nextValue = coerce ? coerceScalar(value) : value;
    const currentValue = result[key];

    if (currentValue === undefined) {
      result[key] = nextValue;
      continue;
    }

    if (Array.isArray(currentValue)) {
      currentValue.push(nextValue);
      continue;
    }

    result[key] = [currentValue, nextValue];
  }

  return result;
}

function pushOption(
  options: Record<string, string[]>,
  key: string,
  value: string,
): void {
  options[key] ??= [];
  options[key].push(value);
}
