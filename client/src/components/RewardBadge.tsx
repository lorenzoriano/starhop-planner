import { rewardDots, rewardWord, type RewardResult } from '@/lib/visibility/reward';
import type { VisibilityKind } from '@/lib/visibility/types';
import './BinocularVisibility.css';

/** "How rewarding" (the object itself, lib/visibility/reward.ts): word + five dots. The word carries the meaning. */
export function RewardChip({reward,kind}:{reward:RewardResult;kind?:VisibilityKind}) {
  const word=rewardWord(reward.reward,kind),dots=rewardDots(reward.reward);
  return <span className={`reward-chip reward-dots-${dots}`} aria-label={`How rewarding: ${word}, ${reward.reward.toFixed(1)} of 10${reward.source==='estimated'?' (estimated)':''}`} title={`${reward.reward.toFixed(1)} of 10${reward.source==='estimated'?' · estimated':''}`}>
    <span className="reward-dots" aria-hidden="true">{[0,1,2,3,4].map(i=><i key={i} className={i<dots?'on':''}/>)}</span>
    <strong>{word}</strong>
  </span>;
}

/** Detail block: the reward chip and one plain "why it's worth it" line (never sources). */
export function RewardWhy({reward,kind}:{reward:RewardResult;kind?:VisibilityKind}) {
  return <section className="reward-why" aria-label="How rewarding this object is">
    <div className="reward-why-head"><span className="reward-dim-label">How rewarding</span><RewardChip reward={reward} kind={kind}/><small>in any binoculars under a dark sky — tonight’s view is below</small></div>
    <p><strong>Why it’s worth it:</strong> {reward.why}</p>
  </section>;
}
