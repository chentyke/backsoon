import { selectLocale, translator } from './web/i18n.js';

export function terminalLocale(env) {
  return selectLocale(env.BACKSOON_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG);
}

export const locale = terminalLocale(process.env);
export const msg = translator(locale);
