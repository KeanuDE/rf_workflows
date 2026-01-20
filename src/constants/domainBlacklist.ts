export const DOMAIN_BLACKLIST = [
  "deine-heizungsmeister.de",
  "heizungsfinder.de",
  "heizung.de",
  "sanitaer.org",
  "wer-liefert-was.de",
  "wlw.de",
  "gelbeseiten.de",
  "goyellow.de",
  "11880.com",
  "dasoertliche.de",
  "meinestadt.de",
  "branchenbuch.de",
  "yelp.de",
  "yelp.com",
  "golocal.de",
  "cylex.de",
  "branchen-info.net",
  "firmenwissen.de",
  "northdata.de",
  "unternehmensregister.de",
  "indeed.com",
  "indeed.de",
  "stepstone.de",
  "monster.de",
  "xing.com",
  "linkedin.com",
  "trustpilot.com",
  "trustpilot.de",
  "kununu.com",
  "provenexpert.com",
  "ausgezeichnet.org",
  "wikipedia.org",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "pinterest.com",
  "myhammer.de",
  "check24.de",
  "homebell.com",
  "thermondo.de",
  "heizungsdiscount24.de",
  "ofenseite.com",
  "heizsparer.de",
  "energieheld.de",
  "daa.de",
  "baufoerderer.de",
  "co2online.de",
  "effizienzhaus-online.de",
  "obi.de",
  "hornbach.de",
  "bauhaus.info",
  "hagebau.de",
  "toom.de",
  "globus-baumarkt.de",
  "heizung-online.de",
  "bosy-online.de",
  "sbz-online.de",
  "ikz.de",
  "haustec.de",
];

export function isBlacklistedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return DOMAIN_BLACKLIST.some(blacklisted => 
      hostname === blacklisted || hostname.endsWith("." + blacklisted)
    );
  } catch {
    return false;
  }
}

export function hasAggregatorPattern(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const aggregatorPatterns = [
      /\/firmen\/[a-z-]+\/?$/,
      /\/branche\/[a-z-]+\/?$/,
      /\/region\/[a-z-]+\/?$/,
      /\/stadt\/[a-z-]+\/?$/,
      /\/[a-z-]+\/heizung\/?$/,
      /\/[a-z-]+\/sanitaer\/?$/,
      /\/[a-z-]+\/sanitär\/?$/,
    ];
    return aggregatorPatterns.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}
