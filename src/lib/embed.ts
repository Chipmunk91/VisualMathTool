/**
 * Embed mode — the portability layer 0. Any tool URL (including share links,
 * which carry full state and history) becomes a plug-in component for any
 * page that can host an iframe: append &embed=1 and the site chrome
 * disappears, leaving the tool itself as the whole surface.
 */
export const isEmbed =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";

/** A share URL turned into its embeddable form (the flag rides the query) */
export const toEmbedUrl = (shareUrl: string): string =>
  shareUrl.includes("#") ? shareUrl.replace("#", "&embed=1#") : `${shareUrl}&embed=1`;

/** The copy-paste iframe snippet for a share URL */
export const embedSnippet = (shareUrl: string, title: string): string =>
  `<iframe src="${toEmbedUrl(shareUrl)}" style="width:100%;height:620px;border:0;border-radius:12px;" loading="lazy" title="${title}"></iframe>`;
