import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { type BlogPost } from "@shared/schema";
import { Calendar, User, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

export default function BlogPostDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { data: post, isLoading, error } = useQuery<BlogPost>({
    queryKey: ["/api/blog", slug],
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="space-y-8 animate-pulse">
            <div className="h-8 bg-muted rounded w-1/4" />
            <div className="aspect-[21/9] bg-muted rounded-lg" />
            <div className="h-12 bg-muted rounded w-3/4" />
            <div className="flex gap-4">
              <div className="h-6 bg-muted rounded w-32" />
              <div className="h-6 bg-muted rounded w-32" />
            </div>
            <div className="space-y-4">
              <div className="h-4 bg-muted rounded" />
              <div className="h-4 bg-muted rounded" />
              <div className="h-4 bg-muted rounded w-5/6" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-semibold" data-testid="text-error-heading">Blog Post Not Found</h1>
          <p className="text-muted-foreground" data-testid="text-error-message">
            The blog post you're looking for doesn't exist or has been removed.
          </p>
          <Link href="/blog">
            <Button data-testid="button-back-to-blog">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <article className="max-w-4xl mx-auto px-4 py-12">
        <Link href="/blog">
          <a className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors" data-testid="link-back-to-blog">
            <ArrowLeft className="h-4 w-4" />
            Back to Blog
          </a>
        </Link>

        {post.featuredImage && (
          <div className="aspect-[21/9] overflow-hidden rounded-lg mb-8">
            <img
              src={post.featuredImage}
              alt={post.title}
              className="w-full h-full object-cover"
              data-testid="img-featured"
            />
          </div>
        )}

        <header className="mb-8 space-y-4">
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight font-serif" data-testid="text-title">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-6 text-muted-foreground">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5" />
              <span className="font-medium" data-testid="text-author">{post.author}</span>
            </div>
            {post.publishedAt && (
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <time dateTime={post.publishedAt} data-testid="text-published-date">
                  {format(new Date(post.publishedAt), "MMMM d, yyyy")}
                </time>
              </div>
            )}
          </div>
        </header>

        <div className="prose prose-lg max-w-none" data-testid="content-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-3xl font-semibold mt-8 mb-4">{children}</h1>,
              h2: ({ children }) => <h2 className="text-2xl font-semibold mt-6 mb-3">{children}</h2>,
              h3: ({ children }) => <h3 className="text-xl font-semibold mt-4 mb-2">{children}</h3>,
              p: ({ children }) => <p className="mb-4 leading-relaxed text-foreground">{children}</p>,
              a: ({ children, href }) => (
                <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-2">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-primary/30 pl-4 italic my-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
              ),
              pre: ({ children }) => (
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto my-4">
                  {children}
                </pre>
              ),
              img: ({ src, alt }) => (
                <img src={src} alt={alt || ""} className="rounded-lg my-6 w-full" />
              ),
            }}
          >
            {post.contentMarkdown}
          </ReactMarkdown>
        </div>

        <footer className="mt-12 pt-8 border-t">
          <Link href="/blog">
            <Button variant="outline" data-testid="button-back-bottom">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>
        </footer>
      </article>
    </div>
  );
}
