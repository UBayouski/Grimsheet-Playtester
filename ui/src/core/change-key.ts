// A string that changes when the data on screen changes: the validated results and the job state.
// It leaves out the read times, so a poll that returns the same data gives the same key.
import type { ViewModel } from './types';

export function changeKey(vm: ViewModel): string {
  return JSON.stringify({ results: vm.results, job: vm.job });
}