import * as Ne from "@kirocrew/app-sdk";
import { jsx as r, jsxs as p, Fragment as N } from "react/jsx-runtime";
import { useRef as F, useEffect as $, useSyncExternalStore as Ie, useMemo as Y, useState as Z } from "react";
const Re = "Reading results", Se = "No results yet. The nightly replay has not written any results.", Ee = "No replay run recorded yet", Me = "No hunt has run yet", $e = "The last hunt found no exploits", xe = "Results could not be read", z = "Replay job state is unavailable", _e = "The replay job is not registered", pe = "Kiro Crew did not provide the app API", Oe = "The last replay is older than 36 hours", Le = "Copied", he = "Copy is not available here. Select the text and press Ctrl+C.", Fe = "Results updated", De = "Unknown colour", H = "time unknown", V = "commit unknown", Ue = "Every finding was reproduced by replaying its action list. The hunt is a bounded search, not a proof that no cheaper win exists.", Pe = 'Run it in a Grimsheet checkout after npm ci and npm run build:play (play.mjs stops with "Run npm run build:play first" without the bundle), with the path of a file that holds the Actions_File_Text.', Ve = "found on an earlier commit", je = "level id not valid", Ge = "action list could not be converted to a file", He = "no detail in the last run", qe = "ink not recorded", Ke = "play timed out", We = "oldest to newest", Be = "replay running now", X = "consecutive failures", Je = "paused", j = "unknown", Ye = "No runs recorded", D = "The request failed", Ze = "The request took longer than 10 seconds";
function q(e, n, t) {
  return `${e} ${e === 1 ? n : t} could not be read`;
}
const U = "grimsheet-playtester", ze = `/api/apps/${U}/config`, Xe = "/api/crons", Q = "playtesterResults", h = {
  trend: 30,
  findings: 20,
  levels: 100,
  tokens: 40,
  tokenChars: 140,
  jobs: 50,
  levelIdChars: 80,
  classChars: 40,
  reasonChars: 60,
  statusChars: 40,
  textChars: 200,
  newEditAddresses: 8,
  addressChars: 12,
  trendLevelKeys: 100
}, ee = 1e4;
function b(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
function g(e) {
  return typeof e == "string" ? e : null;
}
function Qe(e) {
  return typeof e == "number" && Number.isFinite(e) ? e : null;
}
function k(e) {
  return typeof e == "number" && Number.isInteger(e) && e >= 0 ? e : null;
}
function K(e) {
  return typeof e == "boolean" ? e : null;
}
function T(e, n) {
  if (e.length <= n) return e;
  let t = n;
  const s = e.charCodeAt(t - 1);
  return t > 0 && s >= 55296 && s <= 56319 && (t -= 1), e.slice(0, t);
}
function u(e, n) {
  const t = Object.getOwnPropertyDescriptor(e, n);
  return t === void 0 || !("value" in t) ? null : t.value;
}
function en(e, n) {
  return Object.prototype.hasOwnProperty.call(e, n) ? u(e, n) : void 0;
}
const fe = ["green", "amber", "red", "error"];
function me(e) {
  return fe.includes(e) ? e : "error";
}
function ge(e) {
  switch (e) {
    case "green":
      return "Green: intended solution holds";
    case "amber":
      return "Amber: wins with a different ink count";
    case "red":
      return "Red: no longer wins";
    case "error":
      return "Not judged";
    case "none":
      return "No result";
  }
}
function nn(e) {
  return fe.includes(e) ? ge(e) : De;
}
function be(e) {
  return `marker-${e}`;
}
const tn = 1296e5, B = 864e13, rn = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;
function sn(e) {
  return e % 4 === 0 && (e % 100 !== 0 || e % 400 === 0);
}
function on(e, n) {
  return [31, sn(e) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][n - 1] ?? 0;
}
function x(e) {
  if (typeof e != "string") return null;
  const n = rn.exec(e);
  if (n === null) return null;
  const t = Number(n[1]), s = Number(n[2]), o = Number(n[3]), l = Number(n[4]), c = Number(n[5]), d = n[6] === void 0 ? 0 : Number(n[6]), i = n[7] === void 0 ? 0 : Number(n[7].slice(0, 3).padEnd(3, "0"));
  if (s < 1 || s > 12 || o < 1 || o > on(t, s) || l > 23 || c > 59 || d > 59) return null;
  let a = 0;
  const f = n[8] ?? "Z";
  if (f !== "Z") {
    const C = Number(f.slice(1, 3)), v = Number(f.slice(4, 6));
    if (C > 23 || v > 59) return null;
    a = (f.startsWith("-") ? -1 : 1) * (C * 60 + v);
  }
  const m = /* @__PURE__ */ new Date(0);
  m.setUTCFullYear(t, s - 1, o), m.setUTCHours(l, c, d, i);
  const y = m.getTime() - a * 6e4;
  return Number.isFinite(y) && Math.abs(y) <= B ? y : null;
}
function ne(e) {
  if (typeof e == "number") {
    if (!Number.isFinite(e) || e < 0) return null;
    const n = e < 1e11 ? e * 1e3 : e;
    return n <= B ? n : null;
  }
  return x(e);
}
function M(e, n) {
  return String(e).padStart(n, "0");
}
function I(e) {
  if (typeof e != "number" || !Number.isFinite(e) || Math.abs(e) > B) return H;
  const n = new Date(e), t = n.getUTCFullYear();
  return t < 0 || t > 9999 ? H : `${M(t, 4)}-${M(n.getUTCMonth() + 1, 2)}-${M(n.getUTCDate(), 2)} ${M(n.getUTCHours(), 2)}:${M(n.getUTCMinutes(), 2)} UTC`;
}
function ln(e, n) {
  return e === null || typeof n != "number" || !Number.isFinite(n) ? !1 : n - e > tn;
}
function un(e) {
  const n = u(e, "finishedAt");
  return x(typeof n == "string" ? n : u(e, "startedAt"));
}
const cn = ["running", "complete", "failed", "cut-short"];
function ye(e) {
  return typeof e == "string" && cn.includes(e) ? e : null;
}
function we(e) {
  return e === 1 ? null : `This value comes from a different schema version (found: ${typeof e == "number" ? String(e) : "none"})`;
}
function an(e) {
  if (!b(e)) return null;
  const n = g(u(e, "runId")), t = g(u(e, "startedAt"));
  if (n === null && t === null) return null;
  const s = g(u(e, "commit")), o = s === null || s === "" ? null : s, l = u(e, "failure");
  let c = null;
  if (b(l)) {
    const d = g(u(l, "stage")), i = g(u(l, "reasonCode")), a = g(u(l, "message"));
    d !== null && i !== null && a !== null && (c = { stage: T(d, h.textChars), reasonCode: T(i, h.textChars), message: T(a, h.textChars) });
  }
  return {
    runId: n === null ? null : T(n, h.levelIdChars),
    state: ye(u(e, "state")),
    commit: o,
    commitShort: o === null ? null : o.slice(0, 7),
    timeMs: un(e),
    failure: c
  };
}
function dn(e) {
  if (e == null) return { entries: [], dropped: 0 };
  if (!Array.isArray(e)) return { entries: [], dropped: 1 };
  const n = [], t = /* @__PURE__ */ new Set();
  let s = 0;
  for (const o of e) {
    if (!b(o)) {
      s += 1;
      continue;
    }
    const l = g(u(o, "levelId")), c = g(u(o, "colour"));
    if (l === null || l.length < 1 || l.length > h.levelIdChars || c === null) {
      s += 1;
      continue;
    }
    if (t.has(l) || n.length >= h.levels) {
      s += 1;
      continue;
    }
    t.add(l);
    const d = k(u(o, "inkSpent")), i = k(u(o, "minimalInk")), a = Qe(u(o, "endHp")), f = g(u(o, "reasonCode"));
    n.push({
      levelId: l,
      colour: me(c),
      label: nn(c),
      ink: d !== null && i !== null ? { spent: d, minimal: i } : null,
      endHp: a !== null && a >= 0 ? a : null,
      reasonCode: f === null ? null : T(f, h.reasonChars),
      timedOut: u(o, "timedOut") === !0
    });
  }
  return { entries: n, dropped: s };
}
function te(e, n) {
  return e === n ? 0 : e === null ? 1 : n === null ? -1 : e < n ? 1 : -1;
}
function pn(e) {
  if (e == null) return { runs: [], dropped: 0 };
  if (!Array.isArray(e)) return { runs: [], dropped: 1 };
  const n = [];
  let t = 0;
  for (const l of e) {
    if (!b(l)) {
      t += 1;
      continue;
    }
    const c = g(u(l, "runId")), d = k(u(l, "counter"));
    if (c === null || c.length < 1 || d === null) {
      t += 1;
      continue;
    }
    const i = g(u(l, "startedAt")), a = g(u(l, "commit")), f = /* @__PURE__ */ new Map(), m = u(l, "levels");
    if (b(m))
      for (const y of Object.keys(m).slice(0, h.trendLevelKeys)) {
        const C = g(u(m, y));
        C !== null && y.length >= 1 && y.length <= h.levelIdChars && f.set(y, me(C));
      }
    n.push({
      runId: T(c, h.levelIdChars),
      counter: d,
      state: ye(u(l, "state")),
      startedAt: i === null ? null : T(i, 40),
      startedMs: x(i),
      commit: a === null || a === "" ? null : a,
      counts: {
        green: k(u(l, "green")),
        amber: k(u(l, "amber")),
        red: k(u(l, "red")),
        error: k(u(l, "error"))
      },
      levels: f
    });
  }
  n.sort((l, c) => c.counter - l.counter || te(l.startedAt, c.startedAt) || te(l.runId, c.runId));
  const s = /* @__PURE__ */ new Set(), o = n.filter((l) => s.has(l.runId) ? !1 : (s.add(l.runId), !0));
  return t += Math.max(0, o.length - h.trend), { runs: o.slice(0, h.trend), dropped: t };
}
const hn = /^[A-Z]+[0-9]+$/, fn = /^[A-Za-z0-9._-]$/, mn = /^[0-9A-Fa-f]{2}$/, gn = /^[a-z0-9][a-z0-9-]*$/, bn = new TextDecoder("utf-8", { fatal: !0, ignoreBOM: !0 });
new TextEncoder();
function yn(e) {
  const n = [];
  for (let t = 0; t < e.length; t += 1) {
    const s = e.charAt(t);
    if (fn.test(s))
      n.push(s.charCodeAt(0));
    else if (s === "%") {
      const o = e.slice(t + 1, t + 3);
      if (!mn.test(o)) return null;
      n.push(parseInt(o, 16)), t += 2;
    } else
      return null;
  }
  try {
    return bn.decode(Uint8Array.from(n));
  } catch {
    return null;
  }
}
function wn(e) {
  if (typeof e != "string") return null;
  switch (e) {
    case "N":
    case "S":
    case "E":
    case "W":
      return { kind: "move", dir: e };
    case "wait":
      return { kind: "wait" };
    case "undo":
      return { kind: "undo" };
  }
  if (!e.startsWith("edit:")) return null;
  const n = e.slice(5), t = n.indexOf("=");
  if (t < 0) return null;
  const s = n.slice(0, t);
  if (s.length > 6 || !hn.test(s)) return null;
  const o = yn(n.slice(t + 1));
  return o === null ? null : { kind: "edit", address: s, raw: o };
}
function Tn(e) {
  if (!Array.isArray(e)) return null;
  const n = [];
  for (const t of e) {
    const s = wn(t);
    if (s === null) return null;
    n.push(s);
  }
  return n;
}
function An(e) {
  return JSON.stringify(e, null, 2);
}
function vn(e) {
  return typeof e == "string" && gn.test(e) ? `node scripts/play.mjs ${e} --actions-file <actions-file>` : null;
}
const re = {
  cheaper_win: "Cheaper win",
  free_win: "Free win",
  unexpected_route: "Unexpected route"
};
function Te(e) {
  const n = g(e);
  return n === null || n === "" ? { commit: null, commitShort: null } : { commit: n, commitShort: n.slice(0, 7) };
}
function Cn(e) {
  const n = g(u(e, "updatedAt")), t = u(e, "counts"), s = (l) => b(t) ? k(u(t, l)) : null, o = g(u(e, "huntId"));
  return {
    updatedAt: n === null ? H : I(x(n)),
    ...Te(u(e, "commit")),
    huntId: o === null ? null : T(o, h.levelIdChars),
    counts: {
      attempts: s("attempts"),
      confirmed: s("confirmed"),
      rejected: s("rejected"),
      error: s("error"),
      duplicate: s("duplicate"),
      notRecorded: s("notRecorded")
    }
  };
}
function kn(e) {
  if (!b(e)) return null;
  const n = g(u(e, "id")), t = g(u(e, "levelId")), s = g(u(e, "class")), o = g(u(e, "foundAt")), l = u(e, "actions");
  if (n === null || n === "" || t === null || t === "" || s === null || o === null || !Array.isArray(l) || l.length < 1 || l.length > h.tokens) return null;
  const c = [];
  for (const v of l) {
    if (typeof v != "string" || v.length > h.tokenChars) return null;
    c.push(v);
  }
  const d = u(e, "result"), i = b(d) ? d : {}, a = u(i, "newEditAddresses"), f = Tn(c), m = T(s, h.classChars), y = x(o), C = T(t, h.levelIdChars);
  return {
    foundMs: y,
    view: {
      id: T(n, h.levelIdChars + 40),
      levelId: C,
      classKey: m,
      classLabel: Object.prototype.hasOwnProperty.call(re, m) ? re[m] : m,
      ...Te(u(e, "commit")),
      foundAt: I(y),
      tokens: c,
      tokensText: c.join(" "),
      replayCommand: vn(C),
      actionsFileText: f === null ? null : An(f),
      result: {
        won: K(u(i, "won")),
        inkSpent: k(u(i, "inkSpent")),
        minimalInk: k(u(i, "minimalInk")),
        editCount: k(u(i, "editCount")),
        newEditAddresses: Array.isArray(a) ? a.filter((v) => typeof v == "string").slice(0, h.newEditAddresses).map((v) => T(v, h.addressChars)) : []
      }
    }
  };
}
function Nn(e) {
  if (e === void 0) return { present: !1, notice: null, header: null, items: [], dropped: 0 };
  if (!b(e)) return { present: !1, notice: null, header: null, items: [], dropped: 1 };
  const n = we(u(e, "schemaVersion")), t = Cn(e), s = u(e, "items");
  if (s === null && !Object.prototype.hasOwnProperty.call(e, "items")) return { present: !0, notice: n, header: t, items: [], dropped: 0 };
  if (!Array.isArray(s)) return { present: !0, notice: n, header: t, items: [], dropped: 1 };
  let o = 0;
  const l = [];
  for (const i of s) {
    const a = kn(i);
    a === null ? o += 1 : l.push(a);
  }
  l.sort((i, a) => i.foundMs !== a.foundMs ? i.foundMs === null ? 1 : a.foundMs === null ? -1 : a.foundMs - i.foundMs : i.view.id === a.view.id ? 0 : i.view.id < a.view.id ? 1 : -1);
  const c = /* @__PURE__ */ new Set(), d = l.filter(({ view: i }) => {
    const a = `${i.levelId}\0${i.classKey}\0${i.tokensText}`;
    return c.has(a) ? !1 : (c.add(a), !0);
  });
  return o += Math.max(0, d.length - h.findings), { present: !0, notice: n, header: t, items: d.slice(0, h.findings).map((i) => i.view), dropped: o };
}
function In(e, n) {
  return typeof e == "string" && e !== "" && typeof n == "string" && n !== "" && e !== n;
}
function G({ label: e, text: n, onCopy: t }) {
  return /* @__PURE__ */ r("button", { type: "button", "aria-label": e, onClick: () => t(n), children: e.replace(/ for .*$/s, "") });
}
function Rn(e) {
  const n = [];
  return e.won !== null && n.push(e.won ? "won" : "not won"), e.inkSpent !== null && e.minimalInk !== null && n.push(`ink spent ${e.inkSpent} of minimal ${e.minimalInk}`), e.editCount !== null && n.push(`edit count ${e.editCount}`), e.newEditAddresses.length > 0 && n.push(`new edit cells ${e.newEditAddresses.join(", ")}`), n.length === 0 ? "Result: not recorded" : `Result: ${n.join(", ")}`;
}
function Sn({ item: e, latestCommit: n, onCopy: t }) {
  return /* @__PURE__ */ p("li", { className: "finding", children: [
    /* @__PURE__ */ r("h3", { children: `${e.levelId}, ${e.classLabel}` }),
    /* @__PURE__ */ p("p", { children: [
      `Found ${e.foundAt} on commit `,
      e.commit === null ? V : /* @__PURE__ */ r("span", { title: e.commit, children: e.commitShort }),
      In(n, e.commit) ? /* @__PURE__ */ r("strong", { children: ` ${Ve}` }) : null
    ] }),
    /* @__PURE__ */ r("p", { children: Rn(e.result) }),
    /* @__PURE__ */ r("p", { children: "Action list:" }),
    /* @__PURE__ */ r("code", { className: "tokens", children: e.tokensText }),
    e.replayCommand === null ? /* @__PURE__ */ r("p", { children: je }) : /* @__PURE__ */ p(N, { children: [
      /* @__PURE__ */ r("p", { children: "Replay command:" }),
      /* @__PURE__ */ r("code", { className: "command", children: e.replayCommand }),
      /* @__PURE__ */ r("p", { children: Pe })
    ] }),
    e.actionsFileText === null ? /* @__PURE__ */ r("p", { children: Ge }) : /* @__PURE__ */ p(N, { children: [
      /* @__PURE__ */ r("p", { children: "Actions file text, to save to a file:" }),
      /* @__PURE__ */ r("pre", { className: "file", children: e.actionsFileText })
    ] }),
    /* @__PURE__ */ p("div", { children: [
      /* @__PURE__ */ r(G, { label: `Copy action list for ${e.levelId}`, text: e.tokensText, onCopy: t }),
      e.replayCommand === null ? null : /* @__PURE__ */ r(G, { label: `Copy replay command for ${e.levelId}`, text: e.replayCommand, onCopy: t }),
      e.actionsFileText === null ? null : /* @__PURE__ */ r(G, { label: `Copy actions file for ${e.levelId}`, text: e.actionsFileText, onCopy: t })
    ] })
  ] });
}
const R = (e) => e === null ? j : String(e);
function En({ header: e }) {
  const n = e.counts;
  return /* @__PURE__ */ p(N, { children: [
    /* @__PURE__ */ r("p", { children: `Last hunt: ${e.updatedAt}, commit ${e.commitShort ?? V}, hunt ${e.huntId ?? j}` }),
    /* @__PURE__ */ r("p", { children: `Counts: attempts: ${R(n.attempts)}, confirmed: ${R(n.confirmed)}, rejected: ${R(n.rejected)}, error: ${R(n.error)}, duplicate: ${R(n.duplicate)}, notRecorded: ${R(n.notRecorded)}` })
  ] });
}
function Mn({ text: e }) {
  const n = F(null);
  return $(() => {
    n.current?.focus(), n.current?.select();
  }, [e]), /* @__PURE__ */ p("div", { children: [
    /* @__PURE__ */ r("p", { children: he }),
    /* @__PURE__ */ r("textarea", { ref: n, readOnly: !0, defaultValue: e, "aria-label": "Text to copy", rows: 4 })
  ] });
}
function $n({ findings: e, latestCommit: n, copyState: t, onCopy: s }) {
  return /* @__PURE__ */ p("section", { "aria-labelledby": "findings-heading", children: [
    /* @__PURE__ */ r("h2", { id: "findings-heading", children: "Findings" }),
    /* @__PURE__ */ r("p", { children: Ue }),
    e.notice === null ? null : /* @__PURE__ */ r("p", { children: e.notice }),
    e.present ? null : /* @__PURE__ */ r("p", { children: Me }),
    e.present && e.header !== null ? /* @__PURE__ */ r(En, { header: e.header }) : null,
    e.present && e.items.length === 0 ? /* @__PURE__ */ r("p", { children: $e }) : null,
    e.items.length > 0 ? /* @__PURE__ */ r("ul", { className: "findings", children: e.items.map((o) => /* @__PURE__ */ r(Sn, { item: o, latestCommit: n, onCopy: s }, o.id)) }) : null,
    e.dropped > 0 ? /* @__PURE__ */ r("p", { children: q(e.dropped, "finding", "findings") }) : null,
    t.kind === "fallback" ? /* @__PURE__ */ r(Mn, { text: t.text }) : null
  ] });
}
function xn({ job: e, route: n }) {
  const t = n.readAt === null ? null : `${n.error === null ? "Job state read at" : "Job state last read at"} ${n.readAt}`;
  return /* @__PURE__ */ p("section", { "aria-labelledby": "job-heading", children: [
    /* @__PURE__ */ r("h2", { id: "job-heading", children: "Replay job" }),
    n.error === null ? null : /* @__PURE__ */ r("p", { role: "alert", children: `${z}: ${n.error}` }),
    e.kind === "pending" ? /* @__PURE__ */ r("p", { children: "Reading job state" }) : null,
    e.kind === "unavailable" && n.error === null ? /* @__PURE__ */ r("p", { children: z }) : null,
    e.kind === "not-registered" ? /* @__PURE__ */ r("p", { children: _e }) : null,
    e.kind === "found" ? /* @__PURE__ */ p("ul", { children: [
      /* @__PURE__ */ r("li", { children: `Last run: ${e.lastRun}` }),
      e.lastStatus === null ? null : /* @__PURE__ */ r("li", { children: `Last status: ${e.lastStatus}` }),
      /* @__PURE__ */ r("li", { children: `Next run: ${e.nextRun}` }),
      e.running ? /* @__PURE__ */ r("li", { children: Be }) : null,
      e.paused ? /* @__PURE__ */ r("li", { children: Je }) : null,
      /* @__PURE__ */ r("li", { className: e.consecutiveFailures !== null && e.consecutiveFailures > 0 ? "warning" : void 0, children: e.consecutiveFailures === null ? `${X}: ${j}` : `${e.consecutiveFailures > 0 ? "Warning: " : ""}${e.consecutiveFailures} ${X}` })
    ] }) : null,
    t === null ? null : /* @__PURE__ */ r("p", { children: t })
  ] });
}
function _n({ cells: e, text: n }) {
  return /* @__PURE__ */ p("div", { className: "trend", children: [
    /* @__PURE__ */ r("div", { role: "img", "aria-label": n, className: "strip", children: [...e].reverse().map((t, s) => /* @__PURE__ */ r("span", { className: `cell ${be(t.colour)}`, "aria-hidden": "true" }, s)) }),
    /* @__PURE__ */ r("p", { children: `${n} (${We})` })
  ] });
}
const _ = (e) => e === null ? j : String(e);
function On({ runs: e }) {
  return /* @__PURE__ */ p("table", { className: "runs", children: [
    /* @__PURE__ */ r("caption", { children: "Counts for each run, newest first" }),
    /* @__PURE__ */ r("thead", { children: /* @__PURE__ */ p("tr", { children: [
      /* @__PURE__ */ r("th", { scope: "col", children: "Run" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Started" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Commit" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Green" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Amber" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Red" }),
      /* @__PURE__ */ r("th", { scope: "col", children: "Not judged" })
    ] }) }),
    /* @__PURE__ */ r("tbody", { children: e.map((n) => /* @__PURE__ */ p("tr", { children: [
      /* @__PURE__ */ r("td", { children: n.runId }),
      /* @__PURE__ */ r("td", { children: n.startedAt }),
      /* @__PURE__ */ r("td", { children: n.commitShort ?? V }),
      /* @__PURE__ */ r("td", { children: _(n.counts.green) }),
      /* @__PURE__ */ r("td", { children: _(n.counts.amber) }),
      /* @__PURE__ */ r("td", { children: _(n.counts.red) }),
      /* @__PURE__ */ r("td", { children: _(n.counts.error) })
    ] }, n.runId)) })
  ] });
}
function Ln({ card: e }) {
  const n = e.outcome === "not judged" && e.reasonCode !== null ? `not judged (reason: ${e.reasonCode})` : e.outcome;
  return /* @__PURE__ */ p("li", { className: "card", children: [
    /* @__PURE__ */ r("h3", { children: e.levelId }),
    /* @__PURE__ */ p("p", { children: [
      /* @__PURE__ */ r("span", { className: `marker ${be(e.colour)}`, "aria-hidden": "true" }),
      /* @__PURE__ */ r("span", { children: e.label })
    ] }),
    /* @__PURE__ */ r("p", { children: n }),
    e.timedOut ? /* @__PURE__ */ r("p", { children: Ke }) : null,
    e.noDetail ? /* @__PURE__ */ r("p", { children: He }) : null,
    /* @__PURE__ */ r("p", { children: e.ink === null ? qe : `ink spent ${e.ink.spent} of minimal ${e.ink.minimal}` }),
    e.endHp === null ? null : /* @__PURE__ */ r("p", { children: `end HP ${e.endHp}` }),
    /* @__PURE__ */ r(_n, { cells: e.trend, text: e.trendText })
  ] });
}
function Fn({ message: e }) {
  return /* @__PURE__ */ r("div", { "aria-live": "polite", className: "live", children: e });
}
function Dn({ replay: e }) {
  return /* @__PURE__ */ p("section", { "aria-labelledby": "replay-heading", children: [
    /* @__PURE__ */ r("h2", { id: "replay-heading", children: "Last replay" }),
    e.runId === null ? null : /* @__PURE__ */ r("p", { children: `Run: ${e.runId}` }),
    /* @__PURE__ */ r("p", { children: e.state === null ? "State: state unknown" : `State: ${e.state}` }),
    /* @__PURE__ */ p("p", { children: [
      "Commit: ",
      e.commit === null ? V : /* @__PURE__ */ p(N, { children: [
        /* @__PURE__ */ r("span", { title: e.commit, children: e.commitShort }),
        /* @__PURE__ */ r("span", { className: "sr-only", children: ` ${e.commit}` })
      ] })
    ] }),
    /* @__PURE__ */ p("p", { children: [
      "Time: ",
      /* @__PURE__ */ r("time", { children: e.time }),
      e.stale ? /* @__PURE__ */ r("strong", { className: "warning", children: ` ${Oe}` }) : null
    ] }),
    e.failure === null ? null : /* @__PURE__ */ r("p", { children: `Failure: stage ${e.failure.stage}, reason ${e.failure.reasonCode}: ${e.failure.message}` })
  ] });
}
const Un = `
.gp-page { font-family: inherit; line-height: 1.45; max-width: 72rem; margin: 0 auto; padding: 1rem; }
.gp-page section { margin: 1.5rem 0; }
.gp-page h1, .gp-page h2, .gp-page h3 { margin: 0.5rem 0; }
.gp-page ul.cards, .gp-page ul.findings { list-style: none; padding: 0; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
.gp-page ul.findings { grid-template-columns: 1fr; }
.gp-page li.card, .gp-page li.finding { border: 1px solid currentColor; border-radius: 0.5rem; padding: 0.75rem; }
.gp-page p { margin: 0.25rem 0; }
.gp-page .marker { display: inline-block; width: 0.9rem; height: 0.9rem; border: 2px solid currentColor; border-radius: 50%; vertical-align: -0.1rem; margin-right: 0.35rem; }
.gp-page .marker-green { background: #2e9e4f; }
.gp-page .marker-amber { background: #e0a100; border-radius: 0; }
.gp-page .marker-red { background: #d13a3a; border-radius: 0.2rem; transform: rotate(45deg); }
.gp-page .marker-error { background: #7a5bd1; border-style: dashed; }
.gp-page .marker-none { background: transparent; border-style: dotted; }
.gp-page .strip { display: flex; gap: 2px; margin: 0.35rem 0; flex-wrap: wrap; }
.gp-page .strip .cell { width: 0.7rem; height: 0.7rem; border: 1px solid currentColor; display: inline-block; margin: 0; }
.gp-page .tokens, .gp-page .command, .gp-page .file { font-family: ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; display: block; padding: 0.35rem; border: 1px solid currentColor; border-radius: 0.25rem; margin: 0.25rem 0; }
.gp-page pre.file { margin: 0.25rem 0; overflow-x: auto; max-width: 100%; }
.gp-page table { border-collapse: collapse; width: 100%; }
.gp-page th, .gp-page td { border: 1px solid currentColor; padding: 0.25rem 0.5rem; text-align: left; }
.gp-page button { font: inherit; padding: 0.3rem 0.7rem; cursor: pointer; margin: 0.15rem 0.25rem 0.15rem 0; }
.gp-page button:focus-visible, .gp-page textarea:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.gp-page textarea { width: 100%; font-family: ui-monospace, Consolas, monospace; }
.gp-page .warning { font-weight: bold; }
.gp-page .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .gp-page * { scroll-behavior: auto; } }
`;
function Pn({ vm: e, inFlight: n, apiMissing: t, appNameNotice: s, liveMessage: o, copyState: l, onRefresh: c, onCopy: d }) {
  const i = e.results, a = e.resultsRoute.readAt === null ? null : `${e.resultsRoute.error === null ? "Results read at" : "Results last read at"} ${e.resultsRoute.readAt}`;
  return /* @__PURE__ */ p(N, { children: [
    /* @__PURE__ */ r("style", { children: Un }),
    /* @__PURE__ */ p("main", { className: "gp-page", "aria-labelledby": "page-title", children: [
      /* @__PURE__ */ r("h1", { id: "page-title", children: "Grimsheet Playtester" }),
      /* @__PURE__ */ p("div", { className: "toolbar", children: [
        /* @__PURE__ */ r("button", { type: "button", onClick: c, "aria-busy": n, disabled: n || t, children: n ? "Reading" : "Refresh" }),
        a === null ? null : /* @__PURE__ */ r("span", { children: ` ${a}` })
      ] }),
      t ? /* @__PURE__ */ r("p", { role: "alert", children: pe }) : null,
      s === null ? null : /* @__PURE__ */ r("p", { children: s }),
      e.loading ? /* @__PURE__ */ r("p", { children: Re }) : null,
      e.loading ? null : /* @__PURE__ */ p(N, { children: [
        e.resultsRoute.error === null ? null : /* @__PURE__ */ r("p", { role: "alert", children: `${xe}: ${e.resultsRoute.error}` }),
        i.hasData && !i.present ? /* @__PURE__ */ r("p", { children: Se }) : null,
        i.present ? /* @__PURE__ */ p(N, { children: [
          i.notice === null ? null : /* @__PURE__ */ r("p", { children: i.notice }),
          i.dropped.levels > 0 ? /* @__PURE__ */ r("p", { children: q(i.dropped.levels, "level entry", "level entries") }) : null,
          i.dropped.trend > 0 ? /* @__PURE__ */ r("p", { children: q(i.dropped.trend, "trend entry", "trend entries") }) : null,
          i.replay === null ? null : /* @__PURE__ */ r(Dn, { replay: i.replay })
        ] }) : null,
        /* @__PURE__ */ r(xn, { job: e.job, route: e.jobRoute }),
        i.present ? /* @__PURE__ */ p(N, { children: [
          /* @__PURE__ */ p("section", { "aria-labelledby": "levels-heading", children: [
            /* @__PURE__ */ r("h2", { id: "levels-heading", children: "Levels" }),
            i.replay === null ? /* @__PURE__ */ r("p", { children: Ee }) : null,
            i.levels.length > 0 ? /* @__PURE__ */ r("ul", { className: "cards", children: i.levels.map((f) => /* @__PURE__ */ r(Ln, { card: f }, f.levelId)) }) : i.replay !== null ? /* @__PURE__ */ r("p", { children: "No level results in this run" }) : null
          ] }),
          i.runs.length > 0 ? /* @__PURE__ */ p("section", { "aria-labelledby": "runs-heading", children: [
            /* @__PURE__ */ r("h2", { id: "runs-heading", children: "Runs" }),
            /* @__PURE__ */ r(On, { runs: i.runs })
          ] }) : null,
          /* @__PURE__ */ r($n, { findings: i.findings, latestCommit: i.replay?.commit ?? null, copyState: l, onCopy: d })
        ] }) : null
      ] }),
      /* @__PURE__ */ r(Fn, { message: o })
    ] })
  ] });
}
function Ae(e) {
  if (!b(e)) return { kind: "unavailable" };
  const n = u(e, "jobs");
  if (!Array.isArray(n)) return { kind: "unavailable" };
  const t = n.slice(0, h.jobs).filter(b), s = t.find((l) => {
    const c = g(u(l, "name"));
    return c !== null && (c === "replay" || c.endsWith("/replay"));
  });
  if (s !== void 0) return { kind: "found", job: s };
  const o = t.find((l) => (g(u(l, "script")) ?? "").includes("replay_cron.py"));
  return o === void 0 ? { kind: "not-registered" } : { kind: "found", job: o };
}
function Vn(e) {
  const n = g(u(e, "last_status"));
  return {
    kind: "found",
    lastRun: I(ne(u(e, "last_run_ts"))),
    lastStatus: n === null ? null : T(n, h.statusChars),
    running: u(e, "is_running") === !0,
    consecutiveFailures: k(u(e, "consecutive_failures")),
    nextRun: I(ne(u(e, "next_run_ts"))),
    paused: K(u(e, "user_paused")) === !0 || K(u(e, "enabled")) === !1
  };
}
function jn(e) {
  const n = Ae(e);
  return n.kind === "found" ? Vn(n.job) : n;
}
function Gn(e) {
  const n = Ae(e);
  return n.kind === "found" && u(n.job, "is_running") === !0;
}
const Hn = 6e4, qn = 15e3;
function W() {
  return { visible: !1, inFlight: !1, lastStartMs: null, isRunning: !1, closed: !1 };
}
function Kn(e) {
  if (!e.visible || e.inFlight) return { do: "none" };
  if (e.lastStartMs === null) return { do: "start" };
  const n = e.isRunning ? Math.min(qn, e.pollIntervalMs) : e.pollIntervalMs, t = e.lastStartMs + n - e.nowMs;
  return t <= 0 ? { do: "start" } : { do: "wait", ms: t };
}
function O(e, n) {
  const t = Kn({ visible: e.visible, inFlight: e.inFlight, lastStartMs: e.lastStartMs, nowMs: n, pollIntervalMs: Hn, isRunning: e.isRunning });
  return t.do === "start" ? { state: { ...e, inFlight: !0, lastStartMs: n }, effect: t } : { state: e, effect: t };
}
function se(e, n) {
  if (e.closed) return { state: e, effect: { do: "none" } };
  switch (n.type) {
    case "mount":
      return O({ ...W(), visible: n.visible }, n.nowMs);
    case "tick":
      return O(e, n.nowMs);
    case "visibility": {
      const t = { ...e, visible: n.visible };
      return n.visible ? O(t, n.nowMs) : { state: t, effect: { do: "none" } };
    }
    case "refresh":
      return !e.visible || e.inFlight ? { state: e, effect: { do: "none" } } : { state: { ...e, inFlight: !0, lastStartMs: n.nowMs }, effect: { do: "start" } };
    case "complete":
      return O({ ...e, inFlight: !1, isRunning: n.isRunning }, n.nowMs);
    case "unmount":
      return { state: { ...e, closed: !0 }, effect: { do: "none" } };
  }
}
const Wn = Ze;
function ie(e) {
  if (!b(e) && !(e instanceof Error)) return D;
  const n = e.message;
  if (typeof n != "string") return D;
  const t = (n.split(/\r?\n/)[0] ?? "").trim();
  if (t === "") return D;
  const s = t.replace(/token=[^\s&]*/gi, "token=…").replace(/Bearer\s+\S+/gi, "Bearer …");
  return T(s, h.textChars);
}
function oe(e, n, t, s) {
  return new Promise((o) => {
    let l = !1, c;
    const d = (a) => {
      l || (l = !0, t.clearTimeout(c), o(a));
    };
    c = t.setTimeout(() => d({ ok: !1, error: Wn }), s);
    let i;
    try {
      i = e.get(n);
    } catch (a) {
      d({ ok: !1, error: ie(a) });
      return;
    }
    Promise.resolve(i).then(
      (a) => d({ ok: !0, value: a }),
      (a) => d({ ok: !1, error: ie(a) })
    );
  });
}
const L = () => ({ status: "pending", hasGood: !1, good: void 0, goodAtMs: null, error: null });
class Bn {
  constructor(n, t, s = { config: ze, crons: Xe }) {
    this.api = n, this.env = t, this.paths = s, this.snapshot = this.build();
  }
  api;
  env;
  paths;
  config = L();
  crons = L();
  sched = W();
  timer = null;
  unsubscribeVisibility = null;
  generation = 0;
  stopped = !0;
  version = 0;
  snapshot;
  // An array, not a Set: the source scan forbids the method that removes a Set member anywhere in src (Requirement 1, criterion 8).
  listeners = [];
  /** Mount: subscribes to the visibility of the page and sends `mount` to the scheduler. */
  start() {
    if (this.stopped = !1, this.generation += 1, this.config = L(), this.crons = L(), this.sched = W(), this.clearTimer(), this.unsubscribeVisibility?.(), this.unsubscribeVisibility = null, this.api === null) {
      const n = { status: "failed", hasGood: !1, good: void 0, goodAtMs: null, error: pe };
      this.config = n, this.crons = { ...n }, this.emit();
      return;
    }
    this.unsubscribeVisibility = this.env.onVisibilityChange(() => this.dispatch({ type: "visibility", nowMs: this.env.nowMs(), visible: this.env.isVisible() })), this.dispatch({ type: "mount", nowMs: this.env.nowMs(), visible: this.env.isVisible() });
  }
  /** Unmount: clears the timer, unsubscribes, and discards every answer that is still to come. */
  stop() {
    this.stopped = !0, this.generation += 1, this.sched = se(this.sched, { type: "unmount" }).state, this.clearTimer(), this.unsubscribeVisibility?.(), this.unsubscribeVisibility = null;
  }
  /** The Refresh_Button. */
  refresh() {
    this.api !== null && this.dispatch({ type: "refresh", nowMs: this.env.nowMs() });
  }
  subscribe(n) {
    return this.listeners = [...this.listeners, n], () => {
      this.listeners = this.listeners.filter((t) => t !== n);
    };
  }
  getSnapshot() {
    return this.snapshot;
  }
  build() {
    return {
      config: this.config,
      crons: this.crons,
      nowMs: this.env.nowMs(),
      inFlight: this.sched.inFlight,
      visible: this.sched.visible,
      version: this.version
    };
  }
  emit() {
    this.version += 1, this.snapshot = this.build();
    for (const n of this.listeners) n();
  }
  clearTimer() {
    this.timer !== null && this.env.clearTimeout(this.timer), this.timer = null;
  }
  dispatch(n) {
    if (this.stopped) return;
    const t = this.sched, { state: s, effect: o } = se(this.sched, n);
    if (this.sched = s, this.clearTimer(), o.do === "start") {
      this.beginRead();
      return;
    }
    o.do === "wait" && (this.timer = this.env.setTimeout(() => this.dispatch({ type: "tick", nowMs: this.env.nowMs() }), o.ms)), (t.visible !== s.visible || t.inFlight !== s.inFlight) && this.emit();
  }
  beginRead() {
    this.generation += 1;
    const n = this.generation;
    this.emit();
    const t = this.api, s = (c, d) => {
      if (n !== this.generation || this.stopped) return;
      const i = c === "config" ? this.config : this.crons, a = d.ok ? { status: "ok", hasGood: !0, good: d.value, goodAtMs: this.env.nowMs(), error: null } : { ...i, status: "failed", error: d.error };
      c === "config" ? this.config = a : this.crons = a, this.emit();
    }, o = oe(t, this.paths.config, this.env, ee).then((c) => s("config", c)), l = oe(t, this.paths.crons, this.env, ee).then((c) => s("crons", c));
    Promise.all([o, l]).then(() => {
      n !== this.generation || this.stopped || this.dispatch({ type: "complete", nowMs: this.env.nowMs(), isRunning: this.crons.hasGood && Gn(this.crons.good) });
    });
  }
}
async function Jn(e, n) {
  if (typeof n.writeText == "function")
    try {
      return await n.writeText(e), { ok: !0 };
    } catch {
    }
  if (typeof n.selectionCopy == "function")
    try {
      if (n.selectionCopy(e) === !0) return { ok: !0 };
    } catch {
    }
  return { ok: !1 };
}
const Yn = 3e3;
function le(e, n) {
  switch (n.type) {
    case "success":
      return { kind: "copied", seq: e.seq + 1 };
    case "failure":
      return { kind: "fallback", seq: e.seq + 1, text: n.text };
    case "clear":
      return e.kind === "copied" && e.seq === n.seq ? { kind: "idle", seq: e.seq } : e;
  }
}
function Zn(e) {
  return e.kind === "copied" ? Le : e.kind === "fallback" ? he : "";
}
function zn() {
  return {
    nowMs: () => Date.now(),
    setTimeout: (e, n) => globalThis.setTimeout(e, n),
    clearTimeout: (e) => globalThis.clearTimeout(e),
    isVisible: () => typeof document > "u" || document.visibilityState !== "hidden",
    onVisibilityChange(e) {
      return typeof document > "u" ? () => {
      } : (document.addEventListener("visibilitychange", e), () => document.removeEventListener("visibilitychange", e));
    }
  };
}
function Xn(e) {
  return typeof e != "string" || e === U ? null : `This page is built for the app "${U}", but Kiro Crew reports "${T(e, 80)}". The page keeps using "${U}".`;
}
function Qn(e) {
  return JSON.stringify({ results: e.results, job: e.job });
}
function ue(e) {
  switch (e) {
    case "green":
    case "amber":
      return "won";
    case "red":
      return "not won";
    case "error":
      return "not judged";
    case "none":
      return "no result";
  }
}
const et = [
  ["green", "green"],
  ["amber", "amber"],
  ["red", "red"],
  ["error", "not judged"],
  ["none", "no result"]
];
function nt(e) {
  if (e.length === 0) return Ye;
  const n = [];
  for (const [t, s] of et) {
    const o = e.filter((l) => l === t).length;
    o > 0 && n.push(`${o} ${s}`);
  }
  return `Last ${e.length} ${e.length === 1 ? "run" : "runs"}: ${n.join(", ")}`;
}
function tt(e, n) {
  const t = new Map(e.map((c) => [c.levelId, c])), s = n[0];
  return [.../* @__PURE__ */ new Set([...t.keys(), ...s ? s.levels.keys() : []])].sort((c, d) => c < d ? -1 : c > d ? 1 : 0).slice(0, h.levels).map((c) => {
    const d = t.get(c), i = n.map((m) => ({ runId: m.runId, counter: m.counter, colour: m.levels.get(c) ?? "none" })), a = { levelId: c, trend: i, trendText: nt(i.map((m) => m.colour)) };
    if (d !== void 0)
      return {
        ...a,
        colour: d.colour,
        label: d.label,
        outcome: ue(d.colour),
        reasonCode: d.colour === "error" ? d.reasonCode : null,
        timedOut: d.timedOut,
        ink: d.ink,
        endHp: d.endHp,
        noDetail: !1
      };
    const f = s?.levels.get(c) ?? "none";
    return { ...a, colour: f, label: ge(f), outcome: ue(f), reasonCode: null, timedOut: !1, ink: null, endHp: null, noDetail: !0 };
  });
}
const ve = { present: !1, notice: null, header: null, items: [], dropped: 0 };
function ce(e) {
  if (!b(e)) return { status: "pending", hasGood: !1, good: void 0, goodAtMs: null, error: null };
  const n = e.status === "ok" || e.status === "failed" ? e.status : "pending", t = typeof e.goodAtMs == "number" && Number.isFinite(e.goodAtMs) ? e.goodAtMs : null;
  return {
    status: n,
    hasGood: e.hasGood === !0,
    good: e.good,
    goodAtMs: t,
    error: typeof e.error == "string" ? e.error : null
  };
}
function ae(e) {
  return {
    error: e.status === "failed" ? T(e.error ?? D, h.textChars) : null,
    readAt: e.hasGood && e.goodAtMs !== null ? I(e.goodAtMs) : null
  };
}
function A(e, n) {
  try {
    return e();
  } catch {
    return n;
  }
}
function P(e, n) {
  return { hasData: e, present: n, notice: null, replay: null, levels: [], runs: [], findings: ve, dropped: { levels: 0, trend: 0 } };
}
function rt(e, n) {
  return {
    runId: e.runId,
    state: e.state,
    commit: e.commit,
    commitShort: e.commitShort,
    time: I(e.timeMs),
    stale: ln(e.timeMs, n),
    failure: e.failure
  };
}
function st(e) {
  return {
    runId: e.runId,
    counter: e.counter,
    state: e.state,
    startedAt: I(e.startedMs),
    commitShort: e.commit === null ? null : e.commit.slice(0, 7),
    counts: e.counts
  };
}
function it(e, n) {
  if (!e.hasGood) return P(!1, !1);
  const t = e.good;
  if (!b(t) || !Object.prototype.hasOwnProperty.call(t, Q)) return P(!0, !1);
  const s = u(t, Q);
  if (!b(s)) return P(!0, !0);
  const o = A(() => u(s, "latest"), null), l = A(() => an(o), null), c = A(
    () => b(o) && l !== null ? dn(u(o, "levels")) : { entries: [], dropped: 0 },
    { entries: [], dropped: 1 }
  ), d = A(() => pn(u(s, "trend")), { runs: [], dropped: 1 }), i = A(() => Nn(en(s, "findings")), { ...ve, dropped: 1 });
  return {
    hasData: !0,
    present: !0,
    notice: A(() => we(u(s, "schemaVersion")), null),
    replay: A(() => l === null ? null : rt(l, n), null),
    levels: A(() => tt(c.entries, d.runs), []),
    runs: A(() => d.runs.map(st), []),
    findings: i,
    dropped: { levels: c.dropped, trend: d.dropped }
  };
}
function ot(e) {
  return e.status === "pending" ? { kind: "pending" } : e.hasGood ? A(() => jn(e.good), { kind: "unavailable" }) : { kind: "unavailable" };
}
function lt(e) {
  const n = ce(e?.config), t = ce(e?.crons), s = e?.nowMs;
  return {
    loading: n.status === "pending" || t.status === "pending",
    resultsRoute: A(() => ae(n), { error: null, readAt: null }),
    jobRoute: A(() => ae(t), { error: null, readAt: null }),
    results: A(() => it(n, s), P(n.hasGood, !1)),
    job: A(() => ot(t), { kind: "unavailable" })
  };
}
function de(e, n) {
  if (e == null || !Object.prototype.hasOwnProperty.call(e, n)) return null;
  const t = e[n];
  return typeof t == "function" ? t : null;
}
const ut = 3e3;
function ct() {
  const e = typeof navigator > "u" ? void 0 : navigator.clipboard;
  return {
    writeText: e !== void 0 && typeof e.writeText == "function" ? (n) => e.writeText(n) : void 0,
    selectionCopy(n) {
      if (typeof document > "u") return !1;
      const t = document.createElement("textarea");
      t.value = n, t.setAttribute("readonly", ""), t.style.position = "fixed", t.style.opacity = "0", document.body.appendChild(t), t.select();
      try {
        return document.execCommand("copy");
      } finally {
        document.body.removeChild(t);
      }
    }
  };
}
function at(e) {
  return b(e) && typeof e.get == "function";
}
function dt(e) {
  const n = de(e, "useAppApi"), t = de(e, "useAppInfo");
  return function() {
    let o = null;
    if (n !== null)
      try {
        const w = n();
        o = at(w) ? w : null;
      } catch {
        o = null;
      }
    let l = null;
    if (t !== null)
      try {
        const w = t();
        l = b(w) ? w.name : null;
      } catch {
        l = null;
      }
    const c = F(o);
    c.current = o;
    const d = F(null);
    if (d.current === null) {
      const w = o === null ? null : { get: (E) => c.current.get(E) };
      d.current = new Bn(w, zn());
    }
    const i = d.current;
    $(() => (i.start(), () => i.stop()), [i]);
    const a = Ie(
      (w) => i.subscribe(w),
      () => i.getSnapshot(),
      () => i.getSnapshot()
    ), f = Y(() => lt({ config: a.config, crons: a.crons, nowMs: a.nowMs }), [a]), m = Y(() => Qn(f), [f]), y = F(null), [C, v] = Z(!1);
    $(() => {
      if (!(a.inFlight || f.loading || a.config.status !== "ok")) {
        if (y.current === null) {
          y.current = m;
          return;
        }
        y.current !== m && (y.current = m, v(!0));
      }
    }, [m, a, f.loading]), $(() => {
      if (!C) return;
      const w = setTimeout(() => v(!1), ut);
      return () => clearTimeout(w);
    }, [C]);
    const [S, J] = Z({ kind: "idle", seq: 0 });
    $(() => {
      if (S.kind !== "copied") return;
      const w = setTimeout(() => J((E) => le(E, { type: "clear", seq: S.seq })), Yn);
      return () => clearTimeout(w);
    }, [S]);
    const Ce = (w) => {
      Jn(w, ct()).then((E) => J((ke) => le(ke, E.ok ? { type: "success" } : { type: "failure", text: w })));
    };
    return /* @__PURE__ */ r(
      Pn,
      {
        vm: f,
        inFlight: a.inFlight,
        apiMissing: o === null,
        appNameNotice: Xn(l),
        liveMessage: Zn(S) || (C ? Fe : ""),
        copyState: S,
        onRefresh: () => i.refresh(),
        onCopy: Ce
      }
    );
  };
}
const ft = dt(Ne);
export {
  ft as default
};
