// The page: a container that reads the two SDK hooks once, runs the controller, and renders the View_Model.
// Only React hooks that exist in React 18 and 19 are used: useSyncExternalStore, useMemo, useRef, useEffect, useState.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DashboardView } from './components/DashboardView';
import { DashboardController } from './controller/controller';
import { COPIED_CLEAR_MS, copyMessage, copyReducer, copyText, type CopyEnv, type CopyState } from './controller/copy';
import { realEnv } from './controller/env';
import type { Api } from './controller/reader';
import { appNameNotice } from './core/app-name';
import { changeKey } from './core/change-key';
import { isRecord } from './core/json';
import { RESULTS_UPDATED } from './core/text';
import { buildViewModel } from './core/viewmodel';
import { pickFunction, type SdkRecord } from './sdk';

const NOTICE_MS = 3000;

/** The copy actions of the browser, read when a button is pressed (never at module load). */
function realCopyEnv(): CopyEnv {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  return {
    writeText: clipboard !== undefined && typeof clipboard.writeText === 'function' ? (text) => clipboard.writeText(text) : undefined,
    selectionCopy(text) {
      if (typeof document === 'undefined') return false;
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        return document.execCommand('copy');
      } finally {
        document.body.removeChild(area);
      }
    },
  };
}

function isApi(value: unknown): value is Api {
  return isRecord(value) && typeof value['get'] === 'function';
}

/**
 * Builds the page component for an SDK record. `useAppApi` and `useAppInfo` are looked up here, once, so that the order of
 * hooks is the same on every render.
 */
export function createDashboardPage(sdk: SdkRecord) {
  const useAppApi = pickFunction(sdk, 'useAppApi');
  const useAppInfo = pickFunction(sdk, 'useAppInfo');

  return function DashboardPage() {
    let api: Api | null = null;
    if (useAppApi !== null) {
      try {
        const found = (useAppApi as () => unknown)();
        api = isApi(found) ? found : null;
      } catch {
        api = null;
      }
    }
    let infoName: unknown = null;
    if (useAppInfo !== null) {
      try {
        const info = (useAppInfo as () => unknown)();
        infoName = isRecord(info) ? info['name'] : null;
      } catch {
        infoName = null;
      }
    }

    // The controller gets an object with a get method only, which calls the latest API of the host.
    const apiRef = useRef<Api | null>(api);
    apiRef.current = api;
    const controllerRef = useRef<DashboardController | null>(null);
    if (controllerRef.current === null) {
      const proxy: Api | null = api === null ? null : { get: (path: string) => (apiRef.current as Api).get(path) };
      controllerRef.current = new DashboardController(proxy, realEnv());
    }
    const controller = controllerRef.current;

    useEffect(() => {
      controller.start();
      return () => controller.stop();
    }, [controller]);

    const snapshot = useSyncExternalStore(
      (listener) => controller.subscribe(listener),
      () => controller.getSnapshot(),
      () => controller.getSnapshot(),
    );
    const vm = useMemo(() => buildViewModel({ config: snapshot.config, crons: snapshot.crons, nowMs: snapshot.nowMs }), [snapshot]);

    // "Results updated" is announced when the data changed after a successful Read, not at every poll.
    const key = useMemo(() => changeKey(vm), [vm]);
    const lastKey = useRef<string | null>(null);
    const [updated, setUpdated] = useState(false);
    useEffect(() => {
      if (snapshot.inFlight || vm.loading || snapshot.config.status !== 'ok') return;
      if (lastKey.current === null) {
        lastKey.current = key;
        return;
      }
      if (lastKey.current !== key) {
        lastKey.current = key;
        setUpdated(true);
      }
    }, [key, snapshot, vm.loading]);
    useEffect(() => {
      if (!updated) return undefined;
      const id = setTimeout(() => setUpdated(false), NOTICE_MS);
      return () => clearTimeout(id);
    }, [updated]);

    const [copy, setCopy] = useState<CopyState>({ kind: 'idle', seq: 0 });
    useEffect(() => {
      if (copy.kind !== 'copied') return undefined;
      const id = setTimeout(() => setCopy((previous) => copyReducer(previous, { type: 'clear', seq: copy.seq })), COPIED_CLEAR_MS);
      return () => clearTimeout(id);
    }, [copy]);
    const onCopy = (text: string): void => {
      void copyText(text, realCopyEnv()).then((outcome) => setCopy((previous) => copyReducer(previous, outcome.ok ? { type: 'success' } : { type: 'failure', text })));
    };

    return (
      <DashboardView
        vm={vm}
        inFlight={snapshot.inFlight}
        apiMissing={api === null}
        appNameNotice={appNameNotice(infoName)}
        liveMessage={copyMessage(copy) || (updated ? RESULTS_UPDATED : '')}
        copyState={copy}
        onRefresh={() => controller.refresh()}
        onCopy={onCopy}
      />
    );
  };
}