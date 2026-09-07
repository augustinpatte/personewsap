/**
 * The country list behind the Teams profile picker.
 *
 * ALL 249 officially assigned ISO 3166-1 alpha-2 codes, each with an English
 * and a French name. Not a curated subset: the previous fifty-entry list was a
 * guess about where readers come from, and a reader from a country that was not
 * guessed had no way to finish the profile Teams now requires. A picker that
 * cannot express somebody's country is a wall in front of the whole feature.
 *
 * A STATIC TABLE RATHER THAN `Intl.DisplayNames` AT RUNTIME. The names below
 * were generated from CLDR through `Intl.DisplayNames` once, on a full-ICU
 * Node, and frozen here — because Hermes ships a trimmed ICU and
 * `Intl.DisplayNames` is not dependably present on every device and OS version
 * this app runs on. Resolving names at runtime would mean a picker that reads
 * "FR" on some phones and "France" on others, in a flow the reader cannot skip.
 * A frozen table renders identically everywhere and is unit-testable, which a
 * platform lookup is not. `resolveCountryNames` below still consults
 * `Intl.DisplayNames` when it exists, but only to localise into a language this
 * table does not carry — never to replace it.
 *
 * There is no geolocation anywhere in this feature: no CoreLocation, no
 * permission prompt, no IP lookup. A country on a leaderboard is a flag beside
 * a name, and asking for a device's position to obtain one would collect
 * something far more sensitive than the product needs.
 */

export type Country = {
  /** ISO 3166-1 alpha-2, uppercase. This is what `profiles.country_code` stores. */
  code: string;
  nameEn: string;
  nameFr: string;
};

export const COUNTRIES: Country[] = [
  { code: "AD", nameEn: "Andorra", nameFr: "Andorre" },
  { code: "AE", nameEn: "United Arab Emirates", nameFr: "Émirats arabes unis" },
  { code: "AF", nameEn: "Afghanistan", nameFr: "Afghanistan" },
  { code: "AG", nameEn: "Antigua & Barbuda", nameFr: "Antigua-et-Barbuda" },
  { code: "AI", nameEn: "Anguilla", nameFr: "Anguilla" },
  { code: "AL", nameEn: "Albania", nameFr: "Albanie" },
  { code: "AM", nameEn: "Armenia", nameFr: "Arménie" },
  { code: "AO", nameEn: "Angola", nameFr: "Angola" },
  { code: "AQ", nameEn: "Antarctica", nameFr: "Antarctique" },
  { code: "AR", nameEn: "Argentina", nameFr: "Argentine" },
  { code: "AS", nameEn: "American Samoa", nameFr: "Samoa américaines" },
  { code: "AT", nameEn: "Austria", nameFr: "Autriche" },
  { code: "AU", nameEn: "Australia", nameFr: "Australie" },
  { code: "AW", nameEn: "Aruba", nameFr: "Aruba" },
  { code: "AX", nameEn: "Åland Islands", nameFr: "Îles Åland" },
  { code: "AZ", nameEn: "Azerbaijan", nameFr: "Azerbaïdjan" },
  { code: "BA", nameEn: "Bosnia & Herzegovina", nameFr: "Bosnie-Herzégovine" },
  { code: "BB", nameEn: "Barbados", nameFr: "Barbade" },
  { code: "BD", nameEn: "Bangladesh", nameFr: "Bangladesh" },
  { code: "BE", nameEn: "Belgium", nameFr: "Belgique" },
  { code: "BF", nameEn: "Burkina Faso", nameFr: "Burkina Faso" },
  { code: "BG", nameEn: "Bulgaria", nameFr: "Bulgarie" },
  { code: "BH", nameEn: "Bahrain", nameFr: "Bahreïn" },
  { code: "BI", nameEn: "Burundi", nameFr: "Burundi" },
  { code: "BJ", nameEn: "Benin", nameFr: "Bénin" },
  { code: "BL", nameEn: "St. Barthélemy", nameFr: "Saint-Barthélemy" },
  { code: "BM", nameEn: "Bermuda", nameFr: "Bermudes" },
  { code: "BN", nameEn: "Brunei", nameFr: "Brunei" },
  { code: "BO", nameEn: "Bolivia", nameFr: "Bolivie" },
  { code: "BQ", nameEn: "Caribbean Netherlands", nameFr: "Pays-Bas caribéens" },
  { code: "BR", nameEn: "Brazil", nameFr: "Brésil" },
  { code: "BS", nameEn: "Bahamas", nameFr: "Bahamas" },
  { code: "BT", nameEn: "Bhutan", nameFr: "Bhoutan" },
  { code: "BV", nameEn: "Bouvet Island", nameFr: "Île Bouvet" },
  { code: "BW", nameEn: "Botswana", nameFr: "Botswana" },
  { code: "BY", nameEn: "Belarus", nameFr: "Biélorussie" },
  { code: "BZ", nameEn: "Belize", nameFr: "Belize" },
  { code: "CA", nameEn: "Canada", nameFr: "Canada" },
  { code: "CC", nameEn: "Cocos (Keeling) Islands", nameFr: "Îles Cocos" },
  { code: "CD", nameEn: "DR Congo", nameFr: "RD Congo" },
  { code: "CF", nameEn: "Central African Republic", nameFr: "République centrafricaine" },
  { code: "CG", nameEn: "Congo-Brazzaville", nameFr: "Congo-Brazzaville" },
  { code: "CH", nameEn: "Switzerland", nameFr: "Suisse" },
  { code: "CI", nameEn: "Côte d'Ivoire", nameFr: "Côte d'Ivoire" },
  { code: "CK", nameEn: "Cook Islands", nameFr: "Îles Cook" },
  { code: "CL", nameEn: "Chile", nameFr: "Chili" },
  { code: "CM", nameEn: "Cameroon", nameFr: "Cameroun" },
  { code: "CN", nameEn: "China", nameFr: "Chine" },
  { code: "CO", nameEn: "Colombia", nameFr: "Colombie" },
  { code: "CR", nameEn: "Costa Rica", nameFr: "Costa Rica" },
  { code: "CU", nameEn: "Cuba", nameFr: "Cuba" },
  { code: "CV", nameEn: "Cape Verde", nameFr: "Cap-Vert" },
  { code: "CW", nameEn: "Curaçao", nameFr: "Curaçao" },
  { code: "CX", nameEn: "Christmas Island", nameFr: "Île Christmas" },
  { code: "CY", nameEn: "Cyprus", nameFr: "Chypre" },
  { code: "CZ", nameEn: "Czechia", nameFr: "Tchéquie" },
  { code: "DE", nameEn: "Germany", nameFr: "Allemagne" },
  { code: "DJ", nameEn: "Djibouti", nameFr: "Djibouti" },
  { code: "DK", nameEn: "Denmark", nameFr: "Danemark" },
  { code: "DM", nameEn: "Dominica", nameFr: "Dominique" },
  { code: "DO", nameEn: "Dominican Republic", nameFr: "République dominicaine" },
  { code: "DZ", nameEn: "Algeria", nameFr: "Algérie" },
  { code: "EC", nameEn: "Ecuador", nameFr: "Équateur" },
  { code: "EE", nameEn: "Estonia", nameFr: "Estonie" },
  { code: "EG", nameEn: "Egypt", nameFr: "Égypte" },
  { code: "EH", nameEn: "Western Sahara", nameFr: "Sahara occidental" },
  { code: "ER", nameEn: "Eritrea", nameFr: "Érythrée" },
  { code: "ES", nameEn: "Spain", nameFr: "Espagne" },
  { code: "ET", nameEn: "Ethiopia", nameFr: "Éthiopie" },
  { code: "FI", nameEn: "Finland", nameFr: "Finlande" },
  { code: "FJ", nameEn: "Fiji", nameFr: "Fidji" },
  { code: "FK", nameEn: "Falkland Islands", nameFr: "Îles Malouines" },
  { code: "FM", nameEn: "Micronesia", nameFr: "Micronésie" },
  { code: "FO", nameEn: "Faroe Islands", nameFr: "Îles Féroé" },
  { code: "FR", nameEn: "France", nameFr: "France" },
  { code: "GA", nameEn: "Gabon", nameFr: "Gabon" },
  { code: "GB", nameEn: "United Kingdom", nameFr: "Royaume-Uni" },
  { code: "GD", nameEn: "Grenada", nameFr: "Grenade" },
  { code: "GE", nameEn: "Georgia", nameFr: "Géorgie" },
  { code: "GF", nameEn: "French Guiana", nameFr: "Guyane française" },
  { code: "GG", nameEn: "Guernsey", nameFr: "Guernesey" },
  { code: "GH", nameEn: "Ghana", nameFr: "Ghana" },
  { code: "GI", nameEn: "Gibraltar", nameFr: "Gibraltar" },
  { code: "GL", nameEn: "Greenland", nameFr: "Groenland" },
  { code: "GM", nameEn: "Gambia", nameFr: "Gambie" },
  { code: "GN", nameEn: "Guinea", nameFr: "Guinée" },
  { code: "GP", nameEn: "Guadeloupe", nameFr: "Guadeloupe" },
  { code: "GQ", nameEn: "Equatorial Guinea", nameFr: "Guinée équatoriale" },
  { code: "GR", nameEn: "Greece", nameFr: "Grèce" },
  { code: "GS", nameEn: "South Georgia & South Sandwich Islands", nameFr: "Géorgie du Sud-et-les Îles Sandwich du Sud" },
  { code: "GT", nameEn: "Guatemala", nameFr: "Guatemala" },
  { code: "GU", nameEn: "Guam", nameFr: "Guam" },
  { code: "GW", nameEn: "Guinea-Bissau", nameFr: "Guinée-Bissau" },
  { code: "GY", nameEn: "Guyana", nameFr: "Guyana" },
  { code: "HK", nameEn: "Hong Kong SAR China", nameFr: "R.A.S. chinoise de Hong Kong" },
  { code: "HM", nameEn: "Heard & McDonald Islands", nameFr: "Îles Heard-et-MacDonald" },
  { code: "HN", nameEn: "Honduras", nameFr: "Honduras" },
  { code: "HR", nameEn: "Croatia", nameFr: "Croatie" },
  { code: "HT", nameEn: "Haiti", nameFr: "Haïti" },
  { code: "HU", nameEn: "Hungary", nameFr: "Hongrie" },
  { code: "ID", nameEn: "Indonesia", nameFr: "Indonésie" },
  { code: "IE", nameEn: "Ireland", nameFr: "Irlande" },
  { code: "IL", nameEn: "Israel", nameFr: "Israël" },
  { code: "IM", nameEn: "Isle of Man", nameFr: "Île de Man" },
  { code: "IN", nameEn: "India", nameFr: "Inde" },
  { code: "IO", nameEn: "British Indian Ocean Territory", nameFr: "Territoire britannique de l'océan Indien" },
  { code: "IQ", nameEn: "Iraq", nameFr: "Irak" },
  { code: "IR", nameEn: "Iran", nameFr: "Iran" },
  { code: "IS", nameEn: "Iceland", nameFr: "Islande" },
  { code: "IT", nameEn: "Italy", nameFr: "Italie" },
  { code: "JE", nameEn: "Jersey", nameFr: "Jersey" },
  { code: "JM", nameEn: "Jamaica", nameFr: "Jamaïque" },
  { code: "JO", nameEn: "Jordan", nameFr: "Jordanie" },
  { code: "JP", nameEn: "Japan", nameFr: "Japon" },
  { code: "KE", nameEn: "Kenya", nameFr: "Kenya" },
  { code: "KG", nameEn: "Kyrgyzstan", nameFr: "Kirghizstan" },
  { code: "KH", nameEn: "Cambodia", nameFr: "Cambodge" },
  { code: "KI", nameEn: "Kiribati", nameFr: "Kiribati" },
  { code: "KM", nameEn: "Comoros", nameFr: "Comores" },
  { code: "KN", nameEn: "St. Kitts & Nevis", nameFr: "Saint-Christophe-et-Niévès" },
  { code: "KP", nameEn: "North Korea", nameFr: "Corée du Nord" },
  { code: "KR", nameEn: "South Korea", nameFr: "Corée du Sud" },
  { code: "KW", nameEn: "Kuwait", nameFr: "Koweït" },
  { code: "KY", nameEn: "Cayman Islands", nameFr: "Îles Caïmans" },
  { code: "KZ", nameEn: "Kazakhstan", nameFr: "Kazakhstan" },
  { code: "LA", nameEn: "Laos", nameFr: "Laos" },
  { code: "LB", nameEn: "Lebanon", nameFr: "Liban" },
  { code: "LC", nameEn: "St. Lucia", nameFr: "Sainte-Lucie" },
  { code: "LI", nameEn: "Liechtenstein", nameFr: "Liechtenstein" },
  { code: "LK", nameEn: "Sri Lanka", nameFr: "Sri Lanka" },
  { code: "LR", nameEn: "Liberia", nameFr: "Liberia" },
  { code: "LS", nameEn: "Lesotho", nameFr: "Lesotho" },
  { code: "LT", nameEn: "Lithuania", nameFr: "Lituanie" },
  { code: "LU", nameEn: "Luxembourg", nameFr: "Luxembourg" },
  { code: "LV", nameEn: "Latvia", nameFr: "Lettonie" },
  { code: "LY", nameEn: "Libya", nameFr: "Libye" },
  { code: "MA", nameEn: "Morocco", nameFr: "Maroc" },
  { code: "MC", nameEn: "Monaco", nameFr: "Monaco" },
  { code: "MD", nameEn: "Moldova", nameFr: "Moldavie" },
  { code: "ME", nameEn: "Montenegro", nameFr: "Monténégro" },
  { code: "MF", nameEn: "St. Martin", nameFr: "Saint-Martin" },
  { code: "MG", nameEn: "Madagascar", nameFr: "Madagascar" },
  { code: "MH", nameEn: "Marshall Islands", nameFr: "Îles Marshall" },
  { code: "MK", nameEn: "North Macedonia", nameFr: "Macédoine du Nord" },
  { code: "ML", nameEn: "Mali", nameFr: "Mali" },
  { code: "MM", nameEn: "Myanmar", nameFr: "Myanmar (Birmanie)" },
  { code: "MN", nameEn: "Mongolia", nameFr: "Mongolie" },
  { code: "MO", nameEn: "Macao SAR China", nameFr: "R.A.S. chinoise de Macao" },
  { code: "MP", nameEn: "Northern Mariana Islands", nameFr: "Îles Mariannes du Nord" },
  { code: "MQ", nameEn: "Martinique", nameFr: "Martinique" },
  { code: "MR", nameEn: "Mauritania", nameFr: "Mauritanie" },
  { code: "MS", nameEn: "Montserrat", nameFr: "Montserrat" },
  { code: "MT", nameEn: "Malta", nameFr: "Malte" },
  { code: "MU", nameEn: "Mauritius", nameFr: "Maurice" },
  { code: "MV", nameEn: "Maldives", nameFr: "Maldives" },
  { code: "MW", nameEn: "Malawi", nameFr: "Malawi" },
  { code: "MX", nameEn: "Mexico", nameFr: "Mexique" },
  { code: "MY", nameEn: "Malaysia", nameFr: "Malaisie" },
  { code: "MZ", nameEn: "Mozambique", nameFr: "Mozambique" },
  { code: "NA", nameEn: "Namibia", nameFr: "Namibie" },
  { code: "NC", nameEn: "New Caledonia", nameFr: "Nouvelle-Calédonie" },
  { code: "NE", nameEn: "Niger", nameFr: "Niger" },
  { code: "NF", nameEn: "Norfolk Island", nameFr: "Île Norfolk" },
  { code: "NG", nameEn: "Nigeria", nameFr: "Nigeria" },
  { code: "NI", nameEn: "Nicaragua", nameFr: "Nicaragua" },
  { code: "NL", nameEn: "Netherlands", nameFr: "Pays-Bas" },
  { code: "NO", nameEn: "Norway", nameFr: "Norvège" },
  { code: "NP", nameEn: "Nepal", nameFr: "Népal" },
  { code: "NR", nameEn: "Nauru", nameFr: "Nauru" },
  { code: "NU", nameEn: "Niue", nameFr: "Niue" },
  { code: "NZ", nameEn: "New Zealand", nameFr: "Nouvelle-Zélande" },
  { code: "OM", nameEn: "Oman", nameFr: "Oman" },
  { code: "PA", nameEn: "Panama", nameFr: "Panama" },
  { code: "PE", nameEn: "Peru", nameFr: "Pérou" },
  { code: "PF", nameEn: "French Polynesia", nameFr: "Polynésie française" },
  { code: "PG", nameEn: "Papua New Guinea", nameFr: "Papouasie-Nouvelle-Guinée" },
  { code: "PH", nameEn: "Philippines", nameFr: "Philippines" },
  { code: "PK", nameEn: "Pakistan", nameFr: "Pakistan" },
  { code: "PL", nameEn: "Poland", nameFr: "Pologne" },
  { code: "PM", nameEn: "St. Pierre & Miquelon", nameFr: "Saint-Pierre-et-Miquelon" },
  { code: "PN", nameEn: "Pitcairn Islands", nameFr: "Îles Pitcairn" },
  { code: "PR", nameEn: "Puerto Rico", nameFr: "Porto Rico" },
  { code: "PS", nameEn: "Palestine", nameFr: "Palestine" },
  { code: "PT", nameEn: "Portugal", nameFr: "Portugal" },
  { code: "PW", nameEn: "Palau", nameFr: "Palaos" },
  { code: "PY", nameEn: "Paraguay", nameFr: "Paraguay" },
  { code: "QA", nameEn: "Qatar", nameFr: "Qatar" },
  { code: "RE", nameEn: "Réunion", nameFr: "La Réunion" },
  { code: "RO", nameEn: "Romania", nameFr: "Roumanie" },
  { code: "RS", nameEn: "Serbia", nameFr: "Serbie" },
  { code: "RU", nameEn: "Russia", nameFr: "Russie" },
  { code: "RW", nameEn: "Rwanda", nameFr: "Rwanda" },
  { code: "SA", nameEn: "Saudi Arabia", nameFr: "Arabie saoudite" },
  { code: "SB", nameEn: "Solomon Islands", nameFr: "Îles Salomon" },
  { code: "SC", nameEn: "Seychelles", nameFr: "Seychelles" },
  { code: "SD", nameEn: "Sudan", nameFr: "Soudan" },
  { code: "SE", nameEn: "Sweden", nameFr: "Suède" },
  { code: "SG", nameEn: "Singapore", nameFr: "Singapour" },
  { code: "SH", nameEn: "Saint Helena", nameFr: "Sainte-Hélène" },
  { code: "SI", nameEn: "Slovenia", nameFr: "Slovénie" },
  { code: "SJ", nameEn: "Svalbard & Jan Mayen", nameFr: "Svalbard et Jan Mayen" },
  { code: "SK", nameEn: "Slovakia", nameFr: "Slovaquie" },
  { code: "SL", nameEn: "Sierra Leone", nameFr: "Sierra Leone" },
  { code: "SM", nameEn: "San Marino", nameFr: "Saint-Marin" },
  { code: "SN", nameEn: "Senegal", nameFr: "Sénégal" },
  { code: "SO", nameEn: "Somalia", nameFr: "Somalie" },
  { code: "SR", nameEn: "Suriname", nameFr: "Suriname" },
  { code: "SS", nameEn: "South Sudan", nameFr: "Soudan du Sud" },
  { code: "ST", nameEn: "São Tomé & Príncipe", nameFr: "Sao Tomé-et-Principe" },
  { code: "SV", nameEn: "El Salvador", nameFr: "Salvador" },
  { code: "SX", nameEn: "Sint Maarten", nameFr: "Saint-Martin (partie néerlandaise)" },
  { code: "SY", nameEn: "Syria", nameFr: "Syrie" },
  { code: "SZ", nameEn: "Eswatini", nameFr: "Eswatini" },
  { code: "TC", nameEn: "Turks & Caicos Islands", nameFr: "Îles Turques-et-Caïques" },
  { code: "TD", nameEn: "Chad", nameFr: "Tchad" },
  { code: "TF", nameEn: "French Southern Territories", nameFr: "Terres australes françaises" },
  { code: "TG", nameEn: "Togo", nameFr: "Togo" },
  { code: "TH", nameEn: "Thailand", nameFr: "Thaïlande" },
  { code: "TJ", nameEn: "Tajikistan", nameFr: "Tadjikistan" },
  { code: "TK", nameEn: "Tokelau", nameFr: "Tokelau" },
  { code: "TL", nameEn: "Timor-Leste", nameFr: "Timor oriental" },
  { code: "TM", nameEn: "Turkmenistan", nameFr: "Turkménistan" },
  { code: "TN", nameEn: "Tunisia", nameFr: "Tunisie" },
  { code: "TO", nameEn: "Tonga", nameFr: "Tonga" },
  { code: "TR", nameEn: "Türkiye", nameFr: "Turquie" },
  { code: "TT", nameEn: "Trinidad & Tobago", nameFr: "Trinité-et-Tobago" },
  { code: "TV", nameEn: "Tuvalu", nameFr: "Tuvalu" },
  { code: "TW", nameEn: "Taiwan", nameFr: "Taïwan" },
  { code: "TZ", nameEn: "Tanzania", nameFr: "Tanzanie" },
  { code: "UA", nameEn: "Ukraine", nameFr: "Ukraine" },
  { code: "UG", nameEn: "Uganda", nameFr: "Ouganda" },
  { code: "UM", nameEn: "U.S. Outlying Islands", nameFr: "Îles mineures éloignées des États-Unis" },
  { code: "US", nameEn: "United States", nameFr: "États-Unis" },
  { code: "UY", nameEn: "Uruguay", nameFr: "Uruguay" },
  { code: "UZ", nameEn: "Uzbekistan", nameFr: "Ouzbékistan" },
  { code: "VA", nameEn: "Vatican City", nameFr: "Vatican" },
  { code: "VC", nameEn: "St. Vincent & Grenadines", nameFr: "Saint-Vincent-et-les Grenadines" },
  { code: "VE", nameEn: "Venezuela", nameFr: "Venezuela" },
  { code: "VG", nameEn: "British Virgin Islands", nameFr: "Îles Vierges britanniques" },
  { code: "VI", nameEn: "U.S. Virgin Islands", nameFr: "Îles Vierges américaines" },
  { code: "VN", nameEn: "Vietnam", nameFr: "Viêt Nam" },
  { code: "VU", nameEn: "Vanuatu", nameFr: "Vanuatu" },
  { code: "WF", nameEn: "Wallis & Futuna", nameFr: "Wallis-et-Futuna" },
  { code: "WS", nameEn: "Samoa", nameFr: "Samoa" },
  { code: "YE", nameEn: "Yemen", nameFr: "Yémen" },
  { code: "YT", nameEn: "Mayotte", nameFr: "Mayotte" },
  { code: "ZA", nameEn: "South Africa", nameFr: "Afrique du Sud" },
  { code: "ZM", nameEn: "Zambia", nameFr: "Zambie" },
  { code: "ZW", nameEn: "Zimbabwe", nameFr: "Zimbabwe" }
];

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

/** Accent- and case-insensitive, so "etats" finds "États-Unis". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.\-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countryName(country: Country, language: "fr" | "en"): string {
  return language === "fr" ? country.nameFr : country.nameEn;
}

/**
 * Search by name in either language, or by ISO code.
 *
 * BOTH languages are searched, not only the reader's. A French reader who types
 * "Germany" means Germany, and refusing them because the interface is in French
 * would be a puzzle rather than a picker. The result is ordered by how the match
 * was made — prefix of the code, then start of the name, then anywhere inside it
 * — so "in" offers India before Argentina.
 *
 * An empty query returns the whole list rather than nothing: the picker opens
 * showing options.
 */
export function searchCountries(query: string, language: "fr" | "en"): Country[] {
  const needle = fold(query);

  if (needle.length === 0) {
    return COUNTRIES;
  }

  const scored: Array<{ country: Country; score: number }> = [];

  for (const country of COUNTRIES) {
    const primary = fold(countryName(country, language));
    const secondary = fold(language === "fr" ? country.nameEn : country.nameFr);
    const code = country.code.toLowerCase();

    let score: number | null = null;

    if (code === needle) {
      score = 0;
    } else if (code.startsWith(needle)) {
      score = 1;
    } else if (primary.startsWith(needle)) {
      score = 2;
    } else if (secondary.startsWith(needle)) {
      score = 3;
    } else if (primary.includes(needle)) {
      score = 4;
    } else if (secondary.includes(needle)) {
      score = 5;
    }

    if (score !== null) {
      scored.push({ country, score });
    }
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        countryName(a.country, language).localeCompare(countryName(b.country, language))
    )
    .map((entry) => entry.country);
}

export function findCountry(code: string | null | undefined): Country | null {
  if (!code) {
    return null;
  }

  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * The two-letter code, rendered as text rather than as a flag emoji.
 *
 * Deliberately not the regional-indicator flag: several of these territories
 * have no flag glyph on iOS or Android and render as two hollow letter boxes,
 * and a flag beside a name is a political statement the product does not need
 * to make about a disputed territory. "FR" is unambiguous everywhere and scales
 * with Dynamic Type.
 */
export function countryBadge(code: string | null | undefined): string | null {
  const country = findCountry(code);
  return country ? country.code : null;
}

/**
 * A country name in a language this table does not carry.
 *
 * Only used if the product ever adds a third interface language: it asks the
 * platform, and falls back to the frozen English name when `Intl.DisplayNames`
 * is missing or returns nothing usable. The two shipped languages never take
 * this path.
 */
export function resolveCountryNames(code: string, locale: string): string {
  const country = findCountry(code);

  if (!country) {
    return code;
  }

  try {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (
          locales: string[],
          options: { type: string }
        ) => { of: (value: string) => string | undefined };
      }
    ).DisplayNames;

    const resolved = DisplayNames
      ? new DisplayNames([locale], { type: "region" }).of(country.code)
      : null;

    return resolved && resolved !== country.code ? resolved : country.nameEn;
  } catch {
    return country.nameEn;
  }
}
