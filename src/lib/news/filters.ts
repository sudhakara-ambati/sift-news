import type { FetchedArticle } from "./types";

const BLOCKED_DOMAINS = [
  // package registries + dev Q&A
  "pypi.org",
  "npmjs.com",
  "rubygems.org",
  "crates.io",
  "packagist.org",
  "nuget.org",
  "pkg.go.dev",
  "hex.pm",
  "stackoverflow.com",
  "serverfault.com",
  "askubuntu.com",
  // sports (frequent false positives — player initials matching tag tokens)
  "onefootball.com",
  // job boards / recruitment
  "nlppeople.com",
  // academic paper hosts (matches "machine learning" etc. on unrelated papers)
  "pubs.rsc.org",
  // entertainment / gaming / comics
  "bleedingcool.com",
  "comicbook.com",
  "screenrant.com",
  "slashfilm.com",
  "kotaku.com",
  // press-release + low-signal aggregators
  "prlog.org",
  "memeorandum.com",
  "pymnts.com",
  "betalist.com",
  "insivia.com",
  "nextbigfuture.com",
  "freerepublic.com",
  "prnewswire.com",
  "businesswire.com",
  // crypto outlets that cover geopolitics as market commentary — low signal
  "cryptobriefing.com",
  "coinedition.com",
  "cryptopolitan.com",
  "bitcoin.com",
  "cointelegraph.com",
  "decrypt.co",
  "beincrypto.com",
  // Japanese PR
  "prtimes.jp",
  "en.prtimes.jp",
  "signate.jp",
  "atpress.ne.jp",
  "dreamnews.jp",
  "jiji.com",
  "kyodonews.net",
  "einpresswire.com",
  "einnews.com",
  "globenewswire.com",
  "accesswire.com",
  "prunderground.com",
  "wallstreet-online.de",
  // penny-stock hype
  "fool.com",
  "fool.com.au",
];

export function isBlockedUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BLOCKED_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`),
  );
}

export function filterBlockedArticles(
  articles: FetchedArticle[],
): FetchedArticle[] {
  return articles.filter((a) => !isBlockedUrl(a.url));
}

export { BLOCKED_DOMAINS };
