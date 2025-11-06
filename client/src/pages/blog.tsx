import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type BlogPost } from "@shared/schema";
import { Calendar, User, ArrowRight } from "lucide-react";
import { format } from "date-fns";

export default function Blog() {
  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ["/api/blog"],
  });

  return (
    <div className="min-h-screen">
      <section className="py-16 px-4 md:px-8 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-semibold mb-4 font-serif" data-testid="text-blog-heading">
            Our Blog
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Discover travel tips, destination guides, and luxury lifestyle inspiration
          </p>
        </div>
      </section>

      <section className="py-12 px-4 md:px-8">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="overflow-hidden">
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
                No blog posts available yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <Card
                  key={post.id}
                  className="overflow-hidden hover-elevate group"
                  data-testid={`card-blog-post-${post.slug}`}
                >
                  {post.featuredImage ? (
                    <div className="aspect-[16/9] overflow-hidden">
                      <img
                        src={post.featuredImage}
                        alt={post.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        data-testid={`img-featured-${post.slug}`}
                      />
                    </div>
                  ) : (
                    <div className="aspect-[16/9] bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                      <span className="text-6xl text-primary/20 font-serif">
                        {post.title.charAt(0)}
                      </span>
                    </div>
                  )}
                  
                  <CardHeader>
                    <h2 className="text-2xl font-semibold line-clamp-2 group-hover:text-primary transition-colors" data-testid={`text-title-${post.slug}`}>
                      {post.title}
                    </h2>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground line-clamp-3" data-testid={`text-excerpt-${post.slug}`}>
                      {post.excerpt}
                    </p>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span data-testid={`text-author-${post.slug}`}>{post.author}</span>
                      </div>
                      {post.publishedAt && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span data-testid={`text-date-${post.slug}`}>
                            {format(new Date(post.publishedAt), "MMM d, yyyy")}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>

                  <CardFooter>
                    <Link href={`/blog/${post.slug}`}>
                      <a
                        className="inline-flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all"
                        data-testid={`link-read-more-${post.slug}`}
                      >
                        Read More
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
