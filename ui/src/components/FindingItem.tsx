import { isEarlierCommit } from '../core/findings';
import { COMMIT_UNKNOWN, EARLIER_COMMIT, LEVEL_ID_INVALID, NOT_CONVERTIBLE, REPLAY_HELP } from '../core/text';
import type { FindingView } from '../core/types';
import { CopyButton } from './CopyButton';

interface FindingItemProps {
  item: FindingView;
  /** The commit of the latest replay, for the "earlier commit" label. */
  latestCommit: string | null;
  onCopy: (text: string) => void;
}

function resultText(result: FindingView['result']): string {
  const parts: string[] = [];
  if (result.won !== null) parts.push(result.won ? 'won' : 'not won');
  if (result.inkSpent !== null && result.minimalInk !== null) parts.push(`ink spent ${result.inkSpent} of minimal ${result.minimalInk}`);
  if (result.editCount !== null) parts.push(`edit count ${result.editCount}`);
  if (result.newEditAddresses.length > 0) parts.push(`new edit cells ${result.newEditAddresses.join(', ')}`);
  return parts.length === 0 ? 'Result: not recorded' : `Result: ${parts.join(', ')}`;
}

/** One verified finding: where, how, the replay command and the copy actions. */
export function FindingItem({ item, latestCommit, onCopy }: FindingItemProps) {
  return (
    <li className="finding">
      <h3>{`${item.levelId}, ${item.classLabel}`}</h3>
      <p>
        {`Found ${item.foundAt} on commit `}
        {item.commit === null ? (
          COMMIT_UNKNOWN
        ) : (
          <span title={item.commit}>{item.commitShort}</span>
        )}
        {isEarlierCommit(latestCommit, item.commit) ? <strong>{` ${EARLIER_COMMIT}`}</strong> : null}
      </p>
      <p>{resultText(item.result)}</p>
      <p>Action list:</p>
      <code className="tokens">{item.tokensText}</code>
      {item.replayCommand === null ? (
        <p>{LEVEL_ID_INVALID}</p>
      ) : (
        <>
          <p>Replay command:</p>
          <code className="command">{item.replayCommand}</code>
          <p>{REPLAY_HELP}</p>
        </>
      )}
      {item.actionsFileText === null ? (
        <p>{NOT_CONVERTIBLE}</p>
      ) : (
        <>
          <p>Actions file text, to save to a file:</p>
          <pre className="file">{item.actionsFileText}</pre>
        </>
      )}
      <div>
        <CopyButton label={`Copy action list for ${item.levelId}`} text={item.tokensText} onCopy={onCopy} />
        {item.replayCommand === null ? null : <CopyButton label={`Copy replay command for ${item.levelId}`} text={item.replayCommand} onCopy={onCopy} />}
        {item.actionsFileText === null ? null : <CopyButton label={`Copy actions file for ${item.levelId}`} text={item.actionsFileText} onCopy={onCopy} />}
      </div>
    </li>
  );
}