const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const problem = (issues, path, reason) => issues.push({ path, reason });

// Delimiters inside quoted strings belong to the value. Return null on an
// incomplete quoted string instead of pretending a partial list is complete.
export function splitQuoted(text, delimiter) {
  const parts = [];
  let start = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return quoted || escaped ? null : [...parts, text.slice(start)];
}

function unquote(value) {
  if (token.test(value)) return value;
  if (!/^"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t\x20-\x7e\x80-\xff])*"$/.test(value))
    return null;
  return value.slice(1, -1).replace(/\\(.)/gs, '$1');
}

function parameter(raw) {
  const trimmed = raw.trim();
  const equals = trimmed.indexOf('=');
  const name = (equals < 0 ? trimmed : trimmed.slice(0, equals)).trim();
  const rawValue = equals < 0 ? null : trimmed.slice(equals + 1).trim();
  const value = rawValue === null ? null : unquote(rawValue);
  return {
    name,
    value,
    rawValue,
    raw,
    valid: token.test(name) && (rawValue === null || value !== null),
  };
}

function nonnegativeInteger(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
}

function unique(values, issues, path) {
  if (values.length === 0) return null;
  if (new Set(values).size > 1) {
    problem(issues, path, 'conflicting values');
    return null;
  }
  return values[0];
}

function cacheControl(text, row, issues) {
  if (text === null) return;
  const pieces = splitQuoted(text, ',');
  if (!pieces) {
    problem(issues, 'cache-control', 'unterminated quoted string');
    return;
  }
  const entries = pieces.filter((p) => p.trim()).map(parameter);
  let valid = entries.every((p) => p.valid);
  for (const entry of entries)
    if (!entry.valid) problem(issues, 'cache-control', `invalid directive: ${entry.raw}`);
  for (const name of ['max-age', 's-maxage']) {
    const numbers = entries
      .filter((p) => p.name.toLowerCase() === name)
      .map((p) => (p.valid ? nonnegativeInteger(p.value) : null));
    const field = `cc_${name.replaceAll('-', '_')}_seconds`;
    if (numbers.some((n) => n === null)) {
      valid = false;
      problem(issues, field, 'invalid nonnegative integer');
    } else row[field] = unique(numbers, issues, field);
    if (new Set(numbers).size > 1) valid = false;
  }
  const flags = new Map();
  for (const name of ['private', 'no-cache', 'no-store', 'must-revalidate']) {
    const found = entries.filter((p) => p.name.toLowerCase() === name);
    if (!found.length) continue;
    const legal = found.every(
      (p) =>
        p.valid &&
        (p.value === null ||
          ((name === 'private' || name === 'no-cache') &&
            p.rawValue.startsWith('"') &&
            p.value.split(',').every((field) => token.test(field.trim())))),
    );
    flags.set(name, legal ? 1 : null);
    if (!legal) {
      valid = false;
      problem(issues, `cc_${name.replaceAll('-', '_')}`, 'invalid directive parameter');
    }
  }
  for (const name of ['private', 'no-cache', 'no-store', 'must-revalidate']) {
    row[`cc_${name.replaceAll('-', '_')}`] = flags.has(name) ? flags.get(name) : valid ? 0 : null;
  }
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parse only the three HTTP-date productions, validating calendar values too. */
export function httpDate(text, now = new Date()) {
  let weekday, day, month, year, hour, minute, second;
  let m =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
      text,
    );
  if (m) [, weekday, day, month, year, hour, minute, second] = m;
  else if (
    (m =
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
        text,
      ))
  ) {
    [, weekday, day, month, year, hour, minute, second] = m;
    weekday = days[fullDays.indexOf(weekday)];
    year = Math.floor(now.getUTCFullYear() / 100) * 100 + Number(year);
    // RFC 9110: a date more than 50 years in the future means the previous century.
    const boundary = new Date(now);
    boundary.setUTCFullYear(boundary.getUTCFullYear() + 50);
    if (
      Date.UTC(
        year,
        months.indexOf(month),
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ) > boundary.getTime()
    )
      year -= 100;
  } else if (
    (m =
      /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
        text,
      ))
  ) {
    [, weekday, month, day, hour, minute, second, year] = m;
  } else return null;
  const date = new Date(0);
  const normalSecond = Math.min(Number(second), 59);
  date.setUTCFullYear(Number(year), months.indexOf(month), Number(day));
  date.setUTCHours(Number(hour), Number(minute), normalSecond, 0);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== months.indexOf(month) ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    Number(second) > 60 ||
    date.getUTCSeconds() !== normalSecond ||
    days[date.getUTCDay()] !== weekday
  )
    return null;
  // HTTP-date permits a leap second; ECMAScript represents it at the next second.
  if (Number(second) === 60) date.setUTCSeconds(date.getUTCSeconds() + 1);
  return date.toISOString();
}

export function parseHeaders(headers, issues) {
  const row = {};
  if (headers == null) return row;
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    problem(issues, 'headers', 'expected header object');
    return row;
  }
  const map = new Map(),
    invalid = new Set();
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase(),
      list = Array.isArray(value) ? value : [value];
    if (!token.test(name) || !list.every((v) => typeof v === 'string')) {
      invalid.add(key);
      problem(issues, `headers.${name}`, 'expected string or string array with valid header name');
      continue;
    }
    map.set(key, [...(map.get(key) ?? []), ...list]);
  }
  const single = (name) =>
    invalid.has(name) ? null : unique(map.get(name) ?? [], issues, `headers.${name}`);
  const list = (name) => (invalid.has(name) || !map.has(name) ? null : map.get(name).join(', '));
  row.cache_status = single('cf-cache-status');
  row.content_encoding = single('content-encoding');
  row.etag = single('etag');
  const age = single('age');
  row.age_seconds = age === null ? null : nonnegativeInteger(age.trim());
  if (age !== null && row.age_seconds === null)
    problem(issues, 'headers.age', 'invalid nonnegative integer');
  const ray = single('cf-ray');
  row.cf_colo =
    ray === null ? null : (/^[0-9a-f]+-([A-Z]{3})$/i.exec(ray)?.[1]?.toUpperCase() ?? null);
  if (ray !== null && row.cf_colo === null)
    problem(issues, 'headers.cf-ray', 'unrecognized datacenter suffix');
  cacheControl(list('cache-control'), row, issues);
  const modified = single('last-modified');
  row.last_modified_utc = modified === null ? null : httpDate(modified);
  if (modified !== null && row.last_modified_utc === null)
    problem(issues, 'headers.last-modified', 'invalid HTTP-date');
  const contentType = single('content-type');
  if (contentType !== null) {
    const media = contentType.split(';', 1)[0].trim(),
      parts = media.split('/');
    if (parts.length === 2 && parts.every((part) => token.test(part)))
      row.content_media_type = media.toLowerCase();
    else problem(issues, 'headers.content-type', 'invalid media type');
  }
  const vary = list('vary');
  if (vary !== null) {
    const fields = vary
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fields.some((s) => !token.test(s))) problem(issues, 'headers.vary', 'invalid field name');
    else {
      row.vary_star = fields.includes('*') ? 1 : 0;
      row.vary_fields_json = JSON.stringify(
        fields.filter((s) => s !== '*').map((s) => s.toLowerCase()),
      );
    }
  }
  return row;
}
