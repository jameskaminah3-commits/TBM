import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { type BlogPost } from "@shared/schema";
import { Calendar, User, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { SeoHead } from "@/components/seo-head";

function getReadingMinutes(content: string) {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.ceil(words / 180));
}

export default function Blog() {
  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ["/api/blog"],
  });

  return (
    <div className="app-shell min-h-screen">
      <SeoHead
        title="Concierge Articles | Bila Matata"
        description="SEO-friendly travel notes, destination guidance, and concierge insights for guests exploring Kenya with confidence."
        keywords="kenya travel blog, mombasa concierge, luxury stay advice, curated experiences"
        canonicalUrl={typeof window === "undefined" ? "/blog" : `${window.location.origin}/blog`}
      />
      <section className="px-4 py-14 md:px-8 md:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="surface-panel max-w-4xl rounded-[2rem] border px-6 py-8 md:px-8">
            <div className="mb-4 inline-flex rounded-full border border-border/60 bg-background/90 px-4 py-2 text-[0.72rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
              Concierge Journal
            </div>
            <h1 className="mb-4 font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl" data-testid="text-blog-heading">
            Concierge Articles
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Travel notes, destination guidance, and concierge insight to help guests plan more smoothly.
            </p>
          </div>
        </div>
      </section>

      <section className="px-4 pb-14 md:px-8 md:pb-16">
        <div className="mx-auto max-w-7xl">
          {isLoading ? (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="overflow-hidden rounded-[2rem] border-border/60 bg-card/80 backdrop-blur-sm">
                  <div className="aspect-[16/9] bg-muted animate-pulse" />
                  <CardHeader className="space-y-2">
                    <div className="h-6 bg-muted rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-4 bg-muted rounded animate-pulse" />
                      <div className="h-4 bg-muted rounded animate-pulse w-5/6" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-muted-foreground text-lg" data-testid="text-no-posts">
                No concierge articles available yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => {
                const readingMinutes = getReadingMinutes(post.contentMarkdown);

                return (
                  <Card
                    key={post.id}
                    className="surface-card group overflow-hidden rounded-[2rem] border shadow-[0_22px_60px_-38px_rgba(15,23,42,0.34)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_80px_-42px_rgba(15,23,42,0.42)]"
                    data-testid={`card-blog-post-${post.slug}`}
                  >
                    <div className="relative">
                      {post.featuredImage ? (
                        <div className="aspect-[16/10] overflow-hidden">
                          <img
                            src={post.featuredImage}
                            alt={post.featuredImageAlt || post.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                            data-testid={`img-featured-${post.slug}`}
                          />
                        </div>
                      ) : (
                        <div className="flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-primary/12 via-primary/5 to-accent/12">
                          <span className="font-serif text-6xl text-primary/20">
                            {post.title.charAt(0)}
                          </span>
                        </div>
                      )}

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/68 via-slate-900/18 to-transparent p-5">
                        <div className="inline-flex rounded-full border border-white/20 bg-black/20 px-3 py-1 text-[0.68rem] font-medium uppercase tracking-[0.24em] text-white/88 backdrop-blur-sm">
                          Concierge Journal
                        </div>
                      </div>
                    </div>

                    <CardHeader className="space-y-4 px-6 pb-3 pt-5">
                      <div className="flex flex-wrap items-center gap-3 text-[0.78rem] uppercase tracking-[0.2em] text-muted-foreground">
                        {post.publishedAt ? (
                          <span data-testid={`text-date-${post.slug}`}>
                            {format(new Date(post.publishedAt), "MMM d, yyyy")}
                          </span>
                        ) : null}
                        <span>{readingMinutes} min read</span>
                      </div>
                      <h2 className="line-clamp-3 font-serif text-[1.95rem] font-medium leading-[1.05] transition-colors group-hover:text-primary" data-testid={`text-title-${post.slug}`}>
                        {post.title}
                      </h2>
                    </CardHeader>

                    <CardContent className="space-y-5 px-6 pb-4">
                      <p className="line-clamp-4 text-[0.98rem] leading-7 text-muted-foreground" data-testid={`text-excerpt-${post.slug}`}>
                        {post.excerpt}
                      </p>

                      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                        <div className="flex min-w-0 items-center gap-2">
                          <User className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate" data-testid={`text-author-${post.slug}`}>{post.author}</span>
                        </div>
                        {post.publishedAt ? (
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(post.publishedAt), "dd MMM")}</span>
                          </div>
                        ) : null}
                      </div>
                    </CardContent>

                    <CardFooter className="px-6 pb-6 pt-0">
                      <Link href={`/blog/${post.slug}`}>
                        <a
                          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-4 py-2 text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:text-primary"
                          data-testid={`link-read-more-${post.slug}`}
                        >
                          Read Journal Entry
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      </Link>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
