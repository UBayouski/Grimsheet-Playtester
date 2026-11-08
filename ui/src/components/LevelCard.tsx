import { markerClass } from '../core/colour';
import { INK_NOT_RECORDED, NO_DETAIL, TIMED_OUT } from '../core/text';
import type { LevelCardView } from '../core/types';
import { TrendStrip } from './TrendStrip';

/** One level: its stored colour with the text label, the last result, and the trend. */
export function LevelCard({ card }: { card: LevelCardView }) {
  const outcome = card.outcome === 'not judged' && card.reasonCode !== null ? `not judged (reason: ${card.reasonCode})` : card.outcome;
  return (
    <li className="card">
      <h3>{card.levelId}</h3>
      <p>
        <span className={`marker ${markerClass(card.colour)}`} aria-hidden="true" />
        <span>{card.label}</span>
      </p>
      <p>{outcome}</p>
      {card.timedOut ? <p>{TIMED_OUT}</p> : null}
      {card.noDetail ? <p>{NO_DETAIL}</p> : null}
      <p>{card.ink === null ? INK_NOT_RECORDED : `ink spent ${card.ink.spent} of minimal ${card.ink.minimal}`}</p>
      {card.endHp === null ? null : <p>{`end HP ${card.endHp}`}</p>}
      <TrendStrip cells={card.trend} text={card.trendText} />
    </li>
  );
}