import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import type { ReactNode } from "react";
import { type BlogPost } from "@shared/schema";
import { Calendar, User, ArrowLeft, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildTrackedHref,
  captureMarketingQueryParams,
  setMarketingAttributionContext,
  trackMarketingEvent,
  trackMarketingPageView,
} from "@/lib/marketing-attribution";
import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function childrenToText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join("");
  }
  if (children && typeof children === "object" && "props" in children) {
    return childrenToText((children as { props?: { children?: ReactNode } }).props?.children ?? "");
  }
  return "";
}

function isInternalLink(href?: string) {
  if (!href) {
    return false;
  }
  return href.startsWith("/") || href.startsWith("#");
}

function extractFaqSection(markdown: string) {
  const lines = markdown.split("\n");
  const faqStartIndex = lines.findIndex((line) => /^##\s+(faq|frequently asked questions)/i.test(line.trim()));
  if (faqStartIndex === -1) {
    return null;
  }

  let faqEndIndex = lines.length;
  for (let index = faqStartIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      faqEndIndex = index;
      break;
    }
  }

  const faqTitle = lines[faqStartIndex].replace(/^##\s+/, "").trim();
  const sectionLines = lines.slice(faqStartIndex + 1, faqEndIndex);
  const items: Array<{ question: string; answerMarkdown: string }> = [];
  let currentQuestion = "";
  let currentAnswerLines: string[] = [];

  const pushCurrentItem = () => {
    if (!currentQuestion) {
      return;
    }
    items.push({
      question: currentQuestion,
      answerMarkdown: currentAnswerLines.join("\n").trim(),
    });
  };

  for (const line of sectionLines) {
    const trimmed = line.trim();
    const questionMatch = /^###\s+(.+)$/.exec(trimmed);
    if (questionMatch) {
      pushCurrentItem();
      currentQuestion = questionMatch[1].trim();
      currentAnswerLines = [];
      continue;
    }

    currentAnswerLines.push(line);
  }

  pushCurrentItem();

  if (items.length === 0) {
    return null;
  }

  return {
    beforeMarkdown: lines.slice(0, faqStartIndex).join("\n").trim(),
    faqTitle,
    items,
    afterMarkdown: lines.slice(faqEndIndex).join("\n").trim(),
  };
}

export default function BlogPostDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { data: post, isLoading, error } = useQuery<BlogPost>({
    queryKey: ["/api/blog", slug],
    enabled: !!slug,
  });

  const articleMarkdown = useMemo(() => {
    if (!post?.contentMarkdown) {
      return "";
    }

    const lines = post.contentMarkdown.split("\n");
    const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstContentLineIndex === -1) {
      return post.contentMarkdown;
    }

    const firstHeadingMatch = /^#\s+(.+)$/.exec(lines[firstContentLineIndex].trim());
    if (!firstHeadingMatch) {
      return post.contentMarkdown;
    }

    if (slugify(firstHeadingMatch[1]) !== slugify(post.title)) {
      return post.contentMarkdown;
    }

    return [
      ...lines.slice(0, firstContentLineIndex),
      ...lines.slice(firstContentLineIndex + 1),
    ].join("\n").trimStart();
  }, [post?.contentMarkdown, post?.title]);

  const renderedFaqSection = useMemo(
    () => (articleMarkdown ? extractFaqSection(articleMarkdown) : null),
    [articleMarkdown],
  );
  const trackedCtaHref = useMemo(() => {
    if (!post?.primaryCtaHref) {
      return null;
    }

    return buildTrackedHref(post.primaryCtaHref, {
      sourceType: "blog",
      sourceId: post.id,
      sourceSlug: post.slug,
      promoCode: post.primaryPromoCode ?? null,
    });
  }, [post?.id, post?.primaryCtaHref, post?.primaryPromoCode, post?.slug]);

  useEffect(() => {
    captureMarketingQueryParams();
  }, []);

  useEffect(() => {
    if (!post) {
      return;
    }

    const payload = {
      sourceType: "blog" as const,
      sourceId: post.id,
      sourceSlug: post.slug,
      sourcePath: `/blog/${post.slug}`,
      sourceTitle: post.title,
      promoCode: post.primaryPromoCode ?? null,
      landingPath: post.primaryCtaHref ?? null,
    };

    setMarketingAttributionContext(payload);
    void trackMarketingPageView(payload);
  }, [post]);

  const headings = useMemo(() => {
    if (!post?.contentMarkdown) {
      return [];
    }

    const baseMarkdown = renderedFaqSection
      ? [renderedFaqSection.beforeMarkdown, `## ${renderedFaqSection.faqTitle}`, renderedFaqSection.afterMarkdown].filter(Boolean).join("\n")
      : articleMarkdown;

    return baseMarkdown
      .split("\n")
      .map((line) => line.match(/^(##|###)\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        level: match[1] === "##" ? 2 : 3,
        label: match[2].trim(),
        id: slugify(match[2].trim()),
      }));
  }, [articleMarkdown, renderedFaqSection, post?.contentMarkdown]);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="space-y-8 animate-pulse">
            <div className="h-8 w-1/4 rounded bg-muted" />
            <div className="aspect-[21/9] rounded-lg bg-muted" />
            <div className="h-12 w-3/4 rounded bg-muted" />
            <div className="flex gap-4">
              <div className="h-6 w-32 rounded bg-muted" />
              <div className="h-6 w-32 rounded bg-muted" />
            </div>
            <div className="space-y-4">
              <div className="h-4 rounded bg-muted" />
              <div className="h-4 rounded bg-muted" />
              <div className="h-4 w-5/6 rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 text-center">
          <h1 className="font-serif text-4xl font-medium" data-testid="text-error-heading">Article Not Found</h1>
          <p className="text-muted-foreground" data-testid="text-error-message">
            The article you're looking for doesn't exist or has been removed.
          </p>
          <Link href="/blog">
            <Button data-testid="button-back-to-blog">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Articles
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const canonicalUrl = buildCanonicalUrl(`/blog/${post.slug}`);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    image: post.featuredImage ? [post.featuredImage] : undefined,
    datePublished: post.publishedAt || undefined,
    dateModified: post.updatedAt,
    author: {
      "@type": "Person",
      name: post.author,
    },
    mainEntityOfPage: canonicalUrl,
  };

  const markdownComponents = {
    h1: ({ children }: { children?: ReactNode }) => <h1 className="mt-8 font-serif text-2xl font-medium leading-tight sm:mt-10 sm:text-3xl">{children}</h1>,
    h2: ({ children }: { children?: ReactNode }) => {
      const label = childrenToText(children);
      return (
        <h2 id={slugify(label)} className="scroll-mt-24 mt-12 font-serif text-2xl font-medium">
          {children}
        </h2>
      );
    },
    h3: ({ children }: { children?: ReactNode }) => {
      const label = childrenToText(children);
      return (
        <h3 id={slugify(label)} className="scroll-mt-24 mt-8 text-xl font-semibold">
          {children}
        </h3>
      );
    },
    p: ({ children }: { children?: ReactNode }) => <p className="mb-5 leading-7 text-foreground sm:leading-8">{children}</p>,
    a: ({ children, href }: { children?: ReactNode; href?: string }) => {
      if (isInternalLink(href)) {
        if (href?.startsWith("#")) {
          return (
            <a href={href} className="hover:underline">
              {children}
            </a>
          );
        }

        return (
          <Link href={href || "/"}>
            <a className="hover:underline">{children}</a>
          </Link>
        );
      }

      return (
        <a href={href} className="inline-flex items-center gap-1 hover:underline" target="_blank" rel="noopener noreferrer">
          {children}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      );
    },
    ul: ({ children }: { children?: ReactNode }) => <ul className="mb-5 list-disc space-y-2 pl-6">{children}</ul>,
    ol: ({ children }: { children?: ReactNode }) => <ol className="mb-5 list-decimal space-y-2 pl-6">{children}</ol>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className="my-6 rounded-r-2xl border-l-4 border-primary/40 bg-primary/5 px-5 py-4 italic">
        {children}
      </blockquote>
    ),
    code: ({ children }: { children?: ReactNode }) => <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>,
    pre: ({ children }: { children?: ReactNode }) => <pre className="my-6 overflow-x-auto rounded-2xl bg-muted p-4">{children}</pre>,
    img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => (
      <figure className="surface-soft-card my-7 overflow-hidden rounded-2xl border sm:my-10 sm:rounded-[1.75rem]">
        <img src={src || ""} alt={alt || ""} className="h-auto max-h-[75vh] w-full bg-muted/20 object-contain" loading="lazy" />
        {title ? <figcaption className="border-t border-border/60 px-4 py-3 text-xs leading-5 italic text-muted-foreground sm:px-5 sm:py-4 sm:text-sm">{title}</figcaption> : null}
      </figure>
    ),
  };

  return (
    <div className="app-shell min-h-screen">
      <SeoHead
        title={post.seoTitle || post.title}
        description={post.seoDescription || post.excerpt}
        keywords={post.seoKeywords}
        image={post.featuredImage}
        canonicalUrl={canonicalUrl}
        articlePublishedTime={post.publishedAt}
        articleModifiedTime={post.updatedAt}
        articleAuthor={post.author}
        structuredData={structuredData}
      />

      <article className="mx-auto max-w-6xl px-4 py-8 sm:py-10 lg:px-6">
        <Link href="/blog">
          <a className="mb-8 inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground" data-testid="link-back-to-blog">
            <ArrowLeft className="h-4 w-4" />
            Back to Articles
          </a>
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-8">
            {post.featuredImage ? (
              <div className="surface-soft-card overflow-hidden rounded-[2rem] border">
                <img
                  src={post.featuredImage}
                  alt={post.featuredImageAlt || post.title}
                  className="aspect-[16/10] w-full object-cover sm:aspect-[21/9]"
                  data-testid="img-featured"
                />
              </div>
            ) : null}

            <header className="space-y-4 sm:space-y-5">
              <div className="surface-badge inline-flex rounded-full border px-3 py-2 text-[0.65rem] font-medium uppercase tracking-[0.24em] text-muted-foreground sm:px-4 sm:text-xs sm:tracking-[0.28em]">
                Concierge Journal
              </div>
              <h1 className="font-serif text-3xl font-medium leading-tight sm:text-5xl sm:leading-[0.98]" data-testid="text-title">
                {post.title}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">{post.excerpt}</p>

              <div className="flex flex-wrap items-center gap-6 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  <span className="font-medium" data-testid="text-author">{post.author}</span>
                </div>
                {post.publishedAt ? (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    <time dateTime={post.publishedAt} data-testid="text-published-date">
                      {format(new Date(post.publishedAt), "MMMM d, yyyy")}
                    </time>
                  </div>
                ) : null}
              </div>
            </header>

            <div className="prose max-w-none dark:prose-invert prose-headings:font-serif prose-headings:text-foreground prose-p:text-foreground prose-p:leading-7 prose-a:text-primary prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground sm:prose-lg sm:prose-p:leading-8" data-testid="content-markdown">              {renderedFaqSection?.beforeMarkdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {renderedFaqSection.beforeMarkdown}
                </ReactMarkdown>
              ) : null}

              {renderedFaqSection ? (
                <div className="my-12 scroll-mt-24" id={slugify(renderedFaqSection.faqTitle)}>
                  <h2 className="mb-6 font-serif text-2xl font-medium">{renderedFaqSection.faqTitle}</h2>
                  <Accordion type="single" collapsible className="surface-soft-card rounded-[1.75rem] border px-5 py-2">
                    {renderedFaqSection.items.map((item, index) => (
                      <AccordionItem key={`${item.question}-${index}`} value={`faq-${index}`} className="border-border/50">
                        <AccordionTrigger className="py-5 text-left text-base font-medium hover:no-underline">
                          {item.question}
                        </AccordionTrigger>
                                                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-a:text-primary prose-p:leading-7 sm:prose-base">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {item.answerMarkdown}
                            </ReactMarkdown>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              ) : null}

              {renderedFaqSection?.afterMarkdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {renderedFaqSection.afterMarkdown}
                </ReactMarkdown>
              ) : null}

              {!renderedFaqSection ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {articleMarkdown}
                </ReactMarkdown>
              ) : null}
            </div>

            {post.primaryCtaLabel && trackedCtaHref ? (
              <Card className="surface-accent-card">
                <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Ready To Book?
                    </div>
                    <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                      Move from inspiration into a real offer path while keeping this article linked to the eventual booking.
                    </p>
                  </div>
                  <Link href={trackedCtaHref}>
                    <a
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      onClick={() => {
                        const payload = {
                          sourceType: "blog" as const,
                          sourceId: post.id,
                          sourceSlug: post.slug,
                          sourcePath: `/blog/${post.slug}`,
                          sourceTitle: post.title,
                          promoCode: post.primaryPromoCode ?? null,
                          landingPath: post.primaryCtaHref ?? null,
                        };
                        setMarketingAttributionContext(payload);
                        void trackMarketingEvent("cta-click", payload);
                      }}
                    >
                      {post.primaryCtaLabel}
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            <footer className="border-t pt-8">
              <Link href="/blog">
                <Button variant="outline" data-testid="button-back-bottom">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Articles
                </Button>
              </Link>
            </footer>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Card className="surface-soft-card">
              <CardContent className="p-5">
                <div className="mb-4 text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">In This Article</div>
                {headings.length ? (
                  <nav className="space-y-3">
                    {headings.map((heading) => (
                      <a
                        key={`${heading.id}-${heading.level}`}
                        href={`#${heading.id}`}
                        className={`block text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground ${
                          heading.level === 3 ? "pl-4" : ""
                        }`}
                      >
                        {heading.label}
                      </a>
                    ))}
                  </nav>
                ) : (
                  <p className="text-sm text-muted-foreground">Add `##` headings in the article body to build a section navigation here.</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </article>
    </div>
  );
}
