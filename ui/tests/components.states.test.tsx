import { describe, expect, it } from 'vitest';
import { failed, fixture, FINISHED, HOUR, ok, pending, READ_AT, renderView, textOf, vmOf } from './helpers/render';

const twoRuns = () => fixture('config.replay-two-runs.json');
const page = (html: string) => textOf(html);

describe('page states (Requirement 3)', () => {
  it('1. loading: "Reading results"', () => {
    const html = renderView(vmOf(pending(), pending()));
    expect(page(html)).toContain('Reading results');
    expect(html).not.toContain('<h3');
  });

  it('2. no key: the no-results text, no level cards and no findings list', () => {
    const html = renderView(vmOf(ok(fixture('config.no-key.json'))));
    expect(page(html)).toContain('No results yet. The nightly replay has not written any results.');
    expect(html).not.toContain('<h3');
    expect(page(html)).not.toContain('No hunt has run yet');
    expect(page(html)).not.toContain('No replay run recorded yet');
  });

  it('3. key without latest: "No replay run recorded yet", and the trend and findings are still shown', () => {
    const config = twoRuns();
    delete config.playtesterResults.latest;
    const text = page(renderView(vmOf(ok(config))));
    expect(text).toContain('No replay run recorded yet');
    expect(text).toContain('run-000002');
    expect(text).toContain('No hunt has run yet');
    const withFindings = fixture('config.with-findings.json');
    delete withFindings.playtesterResults.latest;
    const text2 = page(renderView(vmOf(ok(withFindings))));
    expect(text2).toContain('No replay run recorded yet');
    expect(text2).toContain('02-the-chaser');
  });

  it('4. findings absent: "No hunt has run yet", and no error', () => {
    const text = page(renderView(vmOf(ok(twoRuns()))));
    expect(text).toContain('No hunt has run yet');
    expect(text).not.toContain('could not be read');
  });

  it('5. findings present with no items: "The last hunt found no exploits" and the hunt header', () => {
    const config = fixture('config.with-findings.json');
    config.playtesterResults.findings.items = [];
    const text = page(renderView(vmOf(ok(config))));
    expect(text).toContain('The last hunt found no exploits');
    expect(text).toContain('hunt-20261108T110312Z');
    expect(text).toContain('2026-11-08 11:14 UTC');
    expect(text).not.toContain('No hunt has run yet');
  });

  it('6. findings without latest: the findings and "No replay run recorded yet"', () => {
    const text = page(renderView(vmOf(ok(fixture('config.findings-only.json')))));
    expect(text).toContain('No replay run recorded yet');
    expect(text).toContain('04-the-trap-row');
    expect(text).toContain('Unexpected route');
  });

  it('7. a failed run: stage, reason code and message, and the cards that exist', () => {
    const config = twoRuns();
    config.playtesterResults.latest.state = 'failed';
    config.playtesterResults.latest.failure = { stage: 'build', reasonCode: 'build_failed', message: 'The Grimsheet build failed with exit code 1.', exitCode: 1 };
    const text = page(renderView(vmOf(ok(config))));
    expect(text).toContain('failed');
    expect(text).toContain('build');
    expect(text).toContain('build_failed');
    expect(text).toContain('The Grimsheet build failed with exit code 1.');
    expect(text).toContain('01-the-corridor');
  });

  it('8. cut-short and running: the state as text, and the levels that are present', () => {
    for (const state of ['cut-short', 'running']) {
      const config = twoRuns();
      config.playtesterResults.latest.state = state;
      const text = page(renderView(vmOf(ok(config))));
      expect(text, state).toContain(state);
      expect(text, state).toContain('03-the-locked-crypt');
    }
  });

  it('9. a config failure: "Results could not be read", the error, "last read at", and the last good results', () => {
    const html = renderView(vmOf(failed('API 500: server error', { value: twoRuns(), at: READ_AT })));
    const text = page(html);
    expect(text).toContain('Results could not be read');
    expect(text).toContain('API 500: server error');
    expect(text).toContain('last read at 2026-11-08 02:00 UTC');
    expect(text).toContain('05-the-lich');
  });

  it('10. a crons failure: "Replay job state is unavailable" in the job area only, results unchanged', () => {
    const html = renderView(vmOf(ok(twoRuns()), failed('crons down')));
    const text = page(html);
    expect(text).toContain('Replay job state is unavailable');
    expect(text).toContain('crons down');
    expect(text).not.toContain('Results could not be read');
    expect(text).toContain('05-the-lich');
    const jobSection = html.slice(html.indexOf('id="job-heading"'));
    expect(textOf(jobSection.slice(0, jobSection.indexOf('</section>')))).toContain('Replay job state is unavailable');
  });

  it('11. no job in the crons answer: "The replay job is not registered"', () => {
    const text = page(renderView(vmOf(ok(twoRuns()), ok(fixture('crons.none.json')))));
    expect(text).toContain('The replay job is not registered');
  });

  it('12. both routes fail on the first Read: both error texts and a Refresh button that works', () => {
    const html = renderView(vmOf(failed('config boom'), failed('crons boom')));
    const text = page(html);
    expect(text).toContain('Results could not be read');
    expect(text).toContain('config boom');
    expect(text).toContain('Replay job state is unavailable');
    expect(text).toContain('crons boom');
    const button = /<button[^>]*>\s*Refresh\s*<\/button>/.exec(html);
    expect(button).not.toBeNull();
    expect(button?.[0]).not.toContain('disabled');
  });
});

describe('page states: texts of Requirements 2, 5 and 9', () => {
  it('shows the dropped counts as text', () => {
    const config = twoRuns();
    config.playtesterResults.latest.levels.push(5, null);
    config.playtesterResults.trend.push('junk');
    const text = page(renderView(vmOf(ok(config))));
    expect(text).toContain('2 level entries could not be read');
    expect(text).toContain('1 trend entry could not be read');
    const findings = fixture('config.with-findings.json');
    findings.playtesterResults.findings.items.push(1, 2);
    expect(page(renderView(vmOf(ok(findings))))).toContain('2 findings could not be read');
  });

  it('shows a schema notice for the results and for the findings', () => {
    expect(page(renderView(vmOf(ok(fixture('config.schema-2.json')))))).toContain('different schema version (found: 2)');
    const config = fixture('config.with-findings.json');
    config.playtesterResults.findings.schemaVersion = 3;
    expect(page(renderView(vmOf(ok(config))))).toContain('different schema version (found: 3)');
  });

  it('shows the app-name notice with both names', () => {
    const text = page(renderView(vmOf(ok(twoRuns())), { appNameNotice: 'This page is built for the app "grimsheet-playtester", but Kiro Crew reports "other".' }));
    expect(text).toContain('grimsheet-playtester');
    expect(text).toContain('other');
  });

  it('shows the missing-API text and disables the Refresh button', () => {
    const html = renderView(vmOf(failed('Kiro Crew did not provide the app API'), failed('Kiro Crew did not provide the app API')), { apiMissing: true });
    expect(page(html)).toContain('Kiro Crew did not provide the app API');
    expect(/<button[^>]*>\s*Refresh\s*<\/button>/.exec(html)?.[0]).toContain('disabled');
  });

  it('shows the Refresh button as busy with the text "Reading" while a Read is in flight', () => {
    const html = renderView(vmOf(ok(twoRuns())), { inFlight: true });
    const button = /<button[^>]*aria-busy[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? '';
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('disabled');
    expect(textOf(button)).toBe('Reading');
  });

  it('shows the time of the last good read of each route', () => {
    const text = page(renderView(vmOf(ok(twoRuns(), READ_AT), ok(fixture('crons.replay-idle.json'), READ_AT + 60_000))));
    expect(text).toContain('Results read at 2026-11-08 02:00 UTC');
    expect(text).toContain('Job state read at 2026-11-08 02:01 UTC');
  });

  it('escapes route text: markup in a failure message appears as text', () => {
    const config = twoRuns();
    config.playtesterResults.latest.state = 'failed';
    config.playtesterResults.latest.failure = { stage: '<i>s</i>', reasonCode: 'x', message: '<b>x</b> & "q"', exitCode: 1 };
    const html = renderView(vmOf(ok(config)));
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>s</i>');
  });

  it('shows the live region with the message', () => {
    const html = renderView(vmOf(ok(twoRuns())), { liveMessage: 'Results updated' });
    expect(/<div[^>]*aria-live="polite"[^>]*>[^<]*Results updated[^<]*<\/div>/.test(html)).toBe(true);
  });
});

describe('last replay and job details (Requirement 5)', () => {
  it('shows the short commit with the full hash in title and in hidden text, the time and the state', () => {
    const html = renderView(vmOf(ok(twoRuns())));
    const text = page(html);
    expect(html).toContain('title="6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b"');
    expect(text).toContain('6372d9a');
    expect(text).toContain('6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b');
    expect(text).toContain('2026-11-08 01:27 UTC');
    expect(text).toContain('complete');
  });

  it('shows "commit unknown" when the commit is null', () => {
    const config = twoRuns();
    config.playtesterResults.latest.commit = null;
    expect(page(renderView(vmOf(ok(config))))).toContain('commit unknown');
  });

  it('shows "time unknown" for a time that does not parse, and no stale warning', () => {
    const config = twoRuns();
    config.playtesterResults.latest.finishedAt = 'garbage';
    const text = page(renderView(vmOf(ok(config))));
    expect(text).toContain('time unknown');
    expect(text).not.toContain('older than 36 hours');
  });

  it('shows the stale warning next to the time when the replay is older than 36 hours', () => {
    const old = page(renderView(vmOf(ok(twoRuns()), undefined, FINISHED + 37 * HOUR)));
    expect(old).toContain('2026-11-08 01:27 UTC The last replay is older than 36 hours');
    expect(page(renderView(vmOf(ok(twoRuns()), undefined, FINISHED + 36 * HOUR)))).not.toContain('older than 36 hours');
  });

  it('shows the job: last run, status, next run, and no warning when there are no failures', () => {
    const text = page(renderView(vmOf(ok(twoRuns()), ok(fixture('crons.replay-idle.json')))));
    expect(text).toContain('Last run: 2026-11-08 01:26 UTC');
    expect(text).toContain('Last status: ok');
    expect(text).toContain('Next run:');
    expect(text).not.toContain('Warning');
    expect(text).not.toContain('replay running now');
  });

  it('shows "replay running now" while the job runs', () => {
    expect(page(renderView(vmOf(ok(twoRuns()), ok(fixture('crons.replay-running.json')))))).toContain('replay running now');
  });

  it('shows consecutive failures with a warning in text, and "paused"', () => {
    const text = page(renderView(vmOf(ok(twoRuns()), ok(fixture('crons.replay-failing.json')))));
    expect(text).toContain('Warning: 3 consecutive failures');
    expect(text).toContain('paused');
  });

  it('never shows a script, a command or a path of the job', () => {
    const text = page(renderView(vmOf(ok(twoRuns()), ok(fixture('crons.replay-failing.json')))));
    expect(text).not.toContain('replay_cron');
    expect(text).not.toContain('script');
  });
});