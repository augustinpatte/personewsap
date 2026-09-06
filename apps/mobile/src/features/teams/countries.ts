/**
 * The country list behind the Teams profile picker.
 *
 * ISO 3166-1 alpha-2, chosen by the reader from a searchable list. There is no
 * geolocation anywhere in this feature: no CoreLocation, no permission prompt,
 * no IP lookup. A country on a leaderboard is a flag next to a name, and asking
 * for a device's position to obtain one would be collecting something far more
 * sensitive than the product needs — and would put a permission dialog in front
 * of somebody trying to join their friends' league.
 *
 * Not the full 249-entry ISO table: this is the set PersoNewsAP's readers
 * actually come from, kept short so the picker is a short scroll rather than a
 * database. Adding an entry is a one-line change, and the ISO code is what is
 * stored either way, so the list can grow without migrating anything.
 */

export type Country = {
  /** ISO 3166-1 alpha-2, uppercase. This is what `profiles.country_code` stores. */
  code: string;
  nameEn: string;
  nameFr: string;
};

export const COUNTRIES: Country[] = [
  { code: "FR", nameEn: "France", nameFr: "France" },
  { code: "BE", nameEn: "Belgium", nameFr: "Belgique" },
  { code: "CH", nameEn: "Switzerland", nameFr: "Suisse" },
  { code: "CA", nameEn: "Canada", nameFr: "Canada" },
  { code: "US", nameEn: "United States", nameFr: "\u00c9tats-Unis" },
  { code: "GB", nameEn: "United Kingdom", nameFr: "Royaume-Uni" },
  { code: "IE", nameEn: "Ireland", nameFr: "Irlande" },
  { code: "DE", nameEn: "Germany", nameFr: "Allemagne" },
  { code: "ES", nameEn: "Spain", nameFr: "Espagne" },
  { code: "IT", nameEn: "Italy", nameFr: "Italie" },
  { code: "PT", nameEn: "Portugal", nameFr: "Portugal" },
  { code: "NL", nameEn: "Netherlands", nameFr: "Pays-Bas" },
  { code: "LU", nameEn: "Luxembourg", nameFr: "Luxembourg" },
  { code: "AT", nameEn: "Austria", nameFr: "Autriche" },
  { code: "SE", nameEn: "Sweden", nameFr: "Su\u00e8de" },
  { code: "NO", nameEn: "Norway", nameFr: "Norv\u00e8ge" },
  { code: "DK", nameEn: "Denmark", nameFr: "Danemark" },
  { code: "FI", nameEn: "Finland", nameFr: "Finlande" },
  { code: "PL", nameEn: "Poland", nameFr: "Pologne" },
  { code: "CZ", nameEn: "Czechia", nameFr: "Tch\u00e9quie" },
  { code: "GR", nameEn: "Greece", nameFr: "Gr\u00e8ce" },
  { code: "RO", nameEn: "Romania", nameFr: "Roumanie" },
  { code: "MA", nameEn: "Morocco", nameFr: "Maroc" },
  { code: "DZ", nameEn: "Algeria", nameFr: "Alg\u00e9rie" },
  { code: "TN", nameEn: "Tunisia", nameFr: "Tunisie" },
  { code: "SN", nameEn: "Senegal", nameFr: "S\u00e9n\u00e9gal" },
  { code: "CI", nameEn: "C\u00f4te d'Ivoire", nameFr: "C\u00f4te d'Ivoire" },
  { code: "CM", nameEn: "Cameroon", nameFr: "Cameroun" },
  { code: "ZA", nameEn: "South Africa", nameFr: "Afrique du Sud" },
  { code: "NG", nameEn: "Nigeria", nameFr: "Nig\u00e9ria" },
  { code: "EG", nameEn: "Egypt", nameFr: "\u00c9gypte" },
  { code: "AE", nameEn: "United Arab Emirates", nameFr: "\u00c9mirats arabes unis" },
  { code: "IL", nameEn: "Israel", nameFr: "Isra\u00ebl" },
  { code: "TR", nameEn: "T\u00fcrkiye", nameFr: "Turquie" },
  { code: "IN", nameEn: "India", nameFr: "Inde" },
  { code: "CN", nameEn: "China", nameFr: "Chine" },
  { code: "JP", nameEn: "Japan", nameFr: "Japon" },
  { code: "KR", nameEn: "South Korea", nameFr: "Cor\u00e9e du Sud" },
  { code: "SG", nameEn: "Singapore", nameFr: "Singapour" },
  { code: "AU", nameEn: "Australia", nameFr: "Australie" },
  { code: "NZ", nameEn: "New Zealand", nameFr: "Nouvelle-Z\u00e9lande" },
  { code: "BR", nameEn: "Brazil", nameFr: "Br\u00e9sil" },
  { code: "AR", nameEn: "Argentina", nameFr: "Argentine" },
  { code: "MX", nameEn: "Mexico", nameFr: "Mexique" },
  { code: "CL", nameEn: "Chile", nameFr: "Chili" },
  { code: "CO", nameEn: "Colombia", nameFr: "Colombie" },
  { code: "PE", nameEn: "Peru", nameFr: "P\u00e9rou" },
  { code: "HK", nameEn: "Hong Kong", nameFr: "Hong Kong" },
  { code: "MC", nameEn: "Monaco", nameFr: "Monaco" },
  { code: "LB", nameEn: "Lebanon", nameFr: "Liban" }
];

/** Accent- and case-insensitive, so "etats" finds "\u00c9tats-Unis". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Search by name in the reader's language, or by ISO code.
 *
 * An empty query returns the whole list rather than nothing: the picker opens
 * showing options, which is what makes it feel like a list and not a puzzle.
 */
export function searchCountries(query: string, language: "fr" | "en"): Country[] {
  const needle = fold(query);

  if (needle.length === 0) {
    return COUNTRIES;
  }

  return COUNTRIES.filter((country) => {
    const name = language === "fr" ? country.nameFr : country.nameEn;
    return fold(name).includes(needle) || fold(country.code).startsWith(needle);
  });
}

export function findCountry(code: string | null | undefined): Country | null {
  if (!code) {
    return null;
  }

  const upper = code.trim().toUpperCase();
  return COUNTRIES.find((country) => country.code === upper) ?? null;
}
