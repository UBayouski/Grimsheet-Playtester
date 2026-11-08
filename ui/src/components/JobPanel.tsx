import { CONSECUTIVE_FAILURES, JOB_NOT_REGISTERED, JOB_UNAVAILABLE, PAUSED, RUNNING_NOW, UNKNOWN } from '../core/text';
import type { JobView, RouteView } from '../core/types';

/** The state of the nightly replay job. Never shows a script, a command or a path. */
export function JobPanel({ job, route }: { job: JobView; route: RouteView }) {
  const readAt = route.readAt === null ? null : `${route.error === null ? 'Job state read at' : 'Job state last read at'} ${route.readAt}`;
  return (
    <section aria-labelledby="job-heading">
      <h2 id="job-heading">Replay job</h2>
      {route.error === null ? null : <p role="alert">{`${JOB_UNAVAILABLE}: ${route.error}`}</p>}
      {job.kind === 'pending' ? <p>Reading job state</p> : null}
      {job.kind === 'unavailable' && route.error === null ? <p>{JOB_UNAVAILABLE}</p> : null}
      {job.kind === 'not-registered' ? <p>{JOB_NOT_REGISTERED}</p> : null}
      {job.kind === 'found' ? (
        <ul>
          <li>{`Last run: ${job.lastRun}`}</li>
          {job.lastStatus === null ? null : <li>{`Last status: ${job.lastStatus}`}</li>}
          <li>{`Next run: ${job.nextRun}`}</li>
          {job.running ? <li>{RUNNING_NOW}</li> : null}
          {job.paused ? <li>{PAUSED}</li> : null}
          <li className={job.consecutiveFailures !== null && job.consecutiveFailures > 0 ? 'warning' : undefined}>
            {job.consecutiveFailures === null
              ? `${CONSECUTIVE_FAILURES}: ${UNKNOWN}`
              : `${job.consecutiveFailures > 0 ? 'Warning: ' : ''}${job.consecutiveFailures} ${CONSECUTIVE_FAILURES}`}
          </li>
        </ul>
      ) : null}
      {readAt === null ? null : <p>{readAt}</p>}
    </section>
  );
}