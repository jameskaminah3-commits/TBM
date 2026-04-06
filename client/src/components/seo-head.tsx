import { useEffect } from "react";

type SeoHeadProps = {
  title: string;
  description?: string | null;
  keywords?: string | null;
  image?: string | null;
  canonicalUrl?: string | null;
  articlePublishedTime?: string | null;
  articleModifiedTime?: string | null;
  articleAuthor?: string | null;
  structuredData?: Record<string, unknown> | null;
};

function upsertMeta(attribute: "name" | "property", key: string, content?: string | null) {
  if (typeof document === "undefined") {
    return;
  }

  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!content) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function upsertLink(rel: string, href?: string | null) {
  if (typeof document === "undefined") {
    return;
  }

  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!href) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }

  element.setAttribute("href", href);
}

function getCspNonce() {
  if (typeof document === "undefined") {
    return null;
  }

  return document.head
    .querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')
    ?.content?.trim() || null;
}

function upsertStructuredData(data?: Record<string, unknown> | null) {
  if (typeof document === "undefined") {
    return;
  }

  const selector = 'script[data-seo-structured="true"]';
  const existing = document.head.querySelector<HTMLScriptElement>(selector);
  if (!data) {
    existing?.remove();
    return;
  }

  const script = existing ?? document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute("data-seo-structured", "true");
  const cspNonce = getCspNonce();
  if (cspNonce) {
    script.setAttribute("nonce", cspNonce);
  }
  script.textContent = JSON.stringify(data);
  if (!existing) {
    document.head.appendChild(script);
  }
}

export function SeoHead({
  title,
  description,
  keywords,
  image,
  canonicalUrl,
  articlePublishedTime,
  articleModifiedTime,
  articleAuthor,
  structuredData,
}: SeoHeadProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    upsertMeta("name", "description", description);
    upsertMeta("name", "keywords", keywords);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", articlePublishedTime ? "article" : "website");
    upsertMeta("property", "og:image", image);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "article:published_time", articlePublishedTime);
    upsertMeta("property", "article:modified_time", articleModifiedTime);
    upsertMeta("property", "article:author", articleAuthor);
    upsertMeta("name", "twitter:card", image ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", image);
    upsertLink("canonical", canonicalUrl);
    upsertStructuredData(structuredData);

    return () => {
      document.title = previousTitle;
    };
  }, [title, description, keywords, image, canonicalUrl, articlePublishedTime, articleModifiedTime, articleAuthor, structuredData]);

  return null;
}
