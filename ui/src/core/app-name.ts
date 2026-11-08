// The notice for a name from useAppInfo that differs from the constant.
import { APP_NAME } from './constants';
import { clip } from './json';

export function appNameNotice(infoName: unknown): string | null {
  if (typeof infoName !== 'string' || infoName === APP_NAME) return null;
  return `This page is built for the app "${APP_NAME}", but Kiro Crew reports "${clip(infoName, 80)}". The page keeps using "${APP_NAME}".`;
}