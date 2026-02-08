import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import frLocale from 'i18n-iso-countries/langs/fr.json';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

countries.registerLocale(enLocale);
countries.registerLocale(frLocale);

export interface CountryOption {
  code: string;
  callingCode: string;
  name: string;
  label: string;
}

export const getCountryOptions = (language: 'fr' | 'en'): CountryOption[] => {
  const names = countries.getNames(language, { select: 'official' }) as Record<string, string>;
  return getCountries()
    .map((code) => {
      let callingCode = '';
      try {
        callingCode = getCountryCallingCode(code);
      } catch {
        callingCode = '';
      }
      const name = names[code] || code;
      const label = callingCode ? `${name} (+${callingCode})` : name;
      return { code, callingCode, name, label };
    })
    .sort((a, b) => a.name.localeCompare(b.name, language));
};
