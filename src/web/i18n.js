import en from './en.js';
import zhCN from './zh-CN.js';
import zhTW from './zh-TW.js';
import ja from './ja.js';
import ko from './ko.js';

export const catalogs = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko };

export function selectLocale(preferences) {
  for (const value of [preferences].flat()) {
    const tag = String(value || '').split(/[.@]/)[0].replaceAll('_', '-');
    try {
      const locale = new Intl.Locale(tag);
      if (locale.language === 'zh') {
        const script = locale.maximize().script;
        if (script === 'Hant') return 'zh-TW';
        if (script === 'Hans') return 'zh-CN';
      }
      if (Object.hasOwn(catalogs, locale.language)) return locale.language;
    } catch {
      // POSIX locale names such as C are not BCP 47 language tags.
    }
  }
  return 'en';
}

export function translator(locale) {
  const messages = catalogs[locale] ?? en;
  return (key, values = {}) =>
    (messages[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
}

// The optional AGENTS.md section, in the language the user chose. Commands,
// flags and tool names stay literal in every translation.
export function rulesLines(locale) {
  const t = translator(locale);
  return ['<!-- BackSoon: start -->', '## BackSoon', '', t('agentsRuleStart'), t('agentsRuleDesktop'), t('agentsRuleFollowUp'),
    '<!-- BackSoon: end -->'];
}
