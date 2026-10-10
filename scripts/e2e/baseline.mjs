// Records the pass/fail baseline of the repo: the full unit suite and the
// bench-HTML play scripts (.cache/*.cjs that open the built bench page).
//
//   node scripts/e2e/baseline.mjs --out <file.json> [--concurrency 3]
//        [--tests-in <dir>] [--only a,b] [--skip-tests] [--skip-bench]
//
// --tests-in runs `npm test` in another checkout (a clean snapshot of the
// branch point) while the bench scripts run in this one, because the bench
// scripts read the prebuilt .cache/asset-bench/living-table-bench.html and
// write into .cache/bench-shots of the cwd.
//
// Bench scripts are slow (35 s to 15 min each). They run N at a time; the
// slowest, actions-play, has a rare settle-timeout flake under load, so a
// failed script is rerun alone once before it is recorded as failed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The 23 scripts under .cache that load living-table-bench.html. The first
// eleven assert and exit non-zero on a failure. The rest are probes or
// screenshot scripts: they exit 0 unless they throw, so "pass" for them means
// "ran without crashing".
export const BENCH_SCRIPTS = [
  { name: "bench-play", asserts: true },
  { name: "art-play", asserts: true },
  { name: "calm-wire", asserts: true },
  { name: "sight-play", asserts: true },
  { name: "sheet-play", asserts: true },
  { name: "dm-play", asserts: true },
  { name: "hud-play", asserts: true },
  { name: "loot-play", asserts: true },
  { name: "multi-play", asserts: true },
  { name: "adventure-run", asserts: true },
  { name: "rat-cellar-play", asserts: true },
  { name: "actions-play", asserts: true },
  { name: "dice-play", asserts: false },
  { name: "goblin-check", asserts: false },
  { name: "turn-check", asserts: false },
  { name: "bench-check", asserts: false },
  { name: "adv-probe", asserts: false },
  { name: "rc-probe", asserts: false },
  { name: "sheet-explore", asserts: false },
  { name: "gear-shots", asserts: false },
  { name: "walls-shot", asserts: false },
  { name: "banner-shot", asserts: false },
  { name: "debug", asserts: false },
];

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const flag = (k) => args.includes(k);

function run(cmd, cmdArgs, cwd, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = fs.openSync(logFile, "w");
    const child = spawn(cmd, cmdArgs, { cwd, shell: true, stdio: ["ignore", out, out], windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.closeSync(out);
      resolve({ exit: timedOut ? "timeout" : code, seconds: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

function tail(file, n = 12) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

async function main() {
  const repo = process.cwd();
  const outFile = path.resolve(opt("--out", "port-baseline.json"));
  const logDir = path.join(path.dirname(outFile), "baseline-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const conc = Number(opt("--concurrency", "3"));
  const only = opt("--only", "") ? opt("--only", "").split(",") : null;
  const testsIn = path.resolve(opt("--tests-in", repo));
  const report = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  const save = () => fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  report.recordedAt = new Date().toISOString();
  report.repo = repo;
  report.node = process.version;
  const head = await new Promise((r) => {
    let s = "";
    const c = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, shell: true });
    c.stdout.on("data", (d) => (s += d));
    c.on("close", () => r(s.trim()));
  });
  report.head = head;
  const benchHtml = path.join(repo, ".cache/asset-bench/living-table-bench.html");
  if (fs.existsSync(benchHtml)) {
    const st = fs.statSync(benchHtml);
    report.benchHtml = { bytes: st.size, mtime: st.mtime.toISOString() };
  }

  const jobs = [];
  if (!flag("--skip-tests")) {
    jobs.push(async () => {
      const log = path.join(logDir, "npm-test.log");
      const r = await run("npm", ["test"], testsIn, log, 20 * 60 * 1000);
      const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
      const num = (k) => {
        const m = text.match(new RegExp(`^# ${k} (\\d+)`, "m"));
        return m ? Number(m[1]) : null;
      };
      report.unitTests = { ranIn: testsIn, exit: r.exit, seconds: r.seconds, tests: num("tests"), pass: num("pass"), fail: num("fail"), skipped: num("skipped"), log };
      save();
      console.log(`npm test: exit ${r.exit} ${report.unitTests.pass}/${report.unitTests.tests} in ${r.seconds}s`);
    });
  }
  if (!flag("--skip-bench")) {
    report.bench = report.bench || {};
    const list = BENCH_SCRIPTS.filter((s) => !only || only.includes(s.name));
    // Slowest first so the long ones overlap the short ones.
    const order = ["actions-play", "adventure-run", "loot-play", "rat-cellar-play"];
    list.sort((a, b) => (order.includes(b.name) ? 1 : 0) - (order.includes(a.name) ? 1 : 0));
    for (const s of list) {
      jobs.push(async () => {
        const script = path.join(repo, ".cache", `${s.name}.cjs`);
        const log = path.join(logDir, `${s.name}.log`);
        let r = await run("node", [`.cache/${s.name}.cjs`], repo, log, 25 * 60 * 1000);
        let rerun = false;
        if (r.exit !== 0) {
          rerun = true;
          r = await run("node", [`.cache/${s.name}.cjs`], repo, log + ".rerun", 25 * 60 * 1000);
        }
        report.bench[s.name] = {
          asserts: s.asserts,
          pass: r.exit === 0,
          exit: r.exit,
          seconds: r.seconds,
          rerunAfterFail: rerun,
          tail: tail(rerun ? log + ".rerun" : log),
        };
        save();
        console.log(`${s.name}: exit ${r.exit} in ${r.seconds}s${rerun ? " (after rerun)" : ""}`);
        void script;
      });
    }
  }
  let next = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (next < jobs.length) await jobs[next++]();
  });
  await Promise.all(workers);
  const b = Object.entries(report.bench || {});
  report.summary = {
    benchPass: b.filter(([, v]) => v.pass).map(([k]) => k),
    benchFail: b.filter(([, v]) => !v.pass).map(([k]) => k),
    unitTests: report.unitTests ? `${report.unitTests.pass}/${report.unitTests.tests}` : null,
  };
  save();
  console.log(JSON.stringify(report.summary));
}

main();
