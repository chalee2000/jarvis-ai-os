#!/usr/bin/env node
// Scans files that would be committed to Git and the built frontend bundle
// (dist/client) for secrets. Prints only file names and rule names, never the
// matched value. Exits with code 1 if anything is found.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const findings = [];

const RULES = [
  { name: "Anthropic API key", regex: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "private key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "database URL with password",
    regex: /postgres(?:ql)?:\/\/[^:\s"'`/]+:([^@\s"'`]+)@([^:/\s"'`]+)/g,
    // Local development and documentation placeholders are allowed.
    allow: (match) =>
      /^(localhost|127\.0\.0\.1)$/.test(match[2]) ||
      match[2].endsWith(".invalid") ||
      /^(<[^>]+>|PASSWORD|CHANGE_ME)$/i.test(match[1]),
  },
];

// The frontend must never reference server-side configuration.
const BUNDLE_FORBIDDEN = ["ANTHROPIC_API_KEY", "SESSION_SECRET", "DATABASE_URL", "x-api-key"];

// Values of real secrets in the current environment must not appear anywhere.
const liveSecrets = ["ANTHROPIC_API_KEY", "SESSION_SECRET"]
  .map((key) => [key, process.env[key]])
  .filter(([, value]) => value && value.length >= 12);
const dbPassword = (() => {
  try {
    return process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : "";
  } catch {
    return "";
  }
})();
if (dbPassword.length >= 12) liveSecrets.push(["DATABASE_URL password", dbPassword]);

function gitFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
    });
    return out.split("\0").filter(Boolean);
  } catch {
    console.error("ไม่พบ Git repository — ข้ามการสแกนไฟล์ใน Git");
    return [];
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [path.relative(root, full)];
  });
}

function isText(buffer) {
  return !buffer.subarray(0, 8000).includes(0);
}

function scan(file, { bundle }) {
  const buffer = fs.readFileSync(path.join(root, file));
  if (!isText(buffer)) return;
  const text = buffer.toString("utf8");
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.regex)) {
      if (rule.allow?.(match)) continue;
      findings.push(`${file}: ${rule.name}`);
    }
  }
  for (const [name, value] of liveSecrets) {
    if (text.includes(value)) findings.push(`${file}: ค่าจริงของ ${name}`);
  }
  if (bundle) {
    for (const word of BUNDLE_FORBIDDEN) {
      if (text.includes(word)) findings.push(`${file}: frontend อ้างถึง ${word}`);
    }
  }
}

const tracked = gitFiles();
for (const file of tracked) {
  const base = path.basename(file);
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
    findings.push(`${file}: ไฟล์ .env ต้องไม่อยู่ใน Git`);
  }
  if (fs.existsSync(path.join(root, file))) scan(file, { bundle: false });
}

const bundleFiles = walk(path.join(root, "dist", "client"));
if (bundleFiles.length === 0) {
  console.error('ไม่พบ dist/client — รัน "npm run build" ก่อนเพื่อตรวจ frontend bundle');
  process.exitCode = 1;
}
for (const file of bundleFiles) scan(file, { bundle: true });

if (findings.length > 0) {
  console.error("พบสิ่งที่อาจเป็น secret:");
  for (const f of new Set(findings)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `ไม่พบ secret: ตรวจไฟล์ใน Git ${tracked.length} ไฟล์ และ frontend bundle ${bundleFiles.length} ไฟล์`,
);
