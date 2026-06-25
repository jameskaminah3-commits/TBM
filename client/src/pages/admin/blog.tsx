import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Bold, Calendar, Edit, FolderOpen, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Plus, Quote, Search, Sparkles, Trash2, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { insertBlogPostSchema, type BlogPost, type InsertBlogPost } from "@shared/schema";
import { AdminLayout } from "@/components/admin-layout";
import { AdminMediaField } from "@/components/admin-media-field";
import { MediaLibraryPicker } from "@/components/media-library-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";

const maxImageDimension = 1280;
const initialImageQuality = 0.82;
const minImageQuality = 0.45;
const targetImageBytes = 1.5 * 1024 * 1024;

const blogFormSchema = insertBlogPostSchema.extend({
  featuredImage: z.string().optional().nullable(),
  featuredImageAlt: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.string().optional(),
  primaryCtaLabel: z.string().optional(),
  primaryCtaHref: z.string().optional(),
  primaryPromoCode: z.string().optional(),
  publishedAt: z.string().optional(),
});

type BlogFormData = z.infer<typeof blogFormSchema>;
type BlogStatusFilter = "all" | "draft" | "published";

function BlogSummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <Card className="border-stone-200/80 bg-white shadow-sm">
      <CardContent className="space-y-1.5 p-4 sm:p-5">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </div>
        <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDateTimeLocalInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16);
  }

  return format(parsed, "yyyy-MM-dd'T'HH:mm");
}

function isSeoReady(post: BlogPost) {
  return Boolean(post.seoTitle?.trim() && post.seoDescription?.trim() && post.featuredImageAlt?.trim());
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function optimizeImage(file: File) {
  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });

  const scale = Math.min(1, maxImageDimension / Math.max(image.width, image.height));
  let width = Math.round(image.width * scale);
  let height = Math.round(image.height * scale);
  let quality = initialImageQuality;
  let currentDataUrl = "";

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not process image");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    currentDataUrl = canvas.toDataURL("image/jpeg", quality);

    const estimatedBytes = Math.ceil((currentDataUrl.length * 3) / 4);
    if (estimatedBytes <= targetImageBytes) {
      return currentDataUrl;
    }

    if (quality > minImageQuality) {
      quality = Math.max(minImageQuality, quality - 0.08);
      continue;
    }

    if (Math.max(width, height) <= 720) {
      return currentDataUrl;
    }

    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    quality = initialImageQuality;
  }
}

function BlogPostForm({ post, onSuccess }: { post?: BlogPost; onSuccess: () => void }) {
  const { toast } = useToast();
  const isEditing = !!post;
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [imageUploadPending, setImageUploadPending] = useState(false);
  const [inlineImageUrl, setInlineImageUrl] = useState("");
  const [inlineImageAlt, setInlineImageAlt] = useState("");
  const [inlineImageCaption, setInlineImageCaption] = useState("");
  const [inlineLibraryOpen, setInlineLibraryOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const form = useForm<BlogFormData>({
    resolver: zodResolver(blogFormSchema),
    defaultValues: {
      title: post?.title || "",
      slug: post?.slug || "",
      excerpt: post?.excerpt || "",
      contentMarkdown: post?.contentMarkdown || "",
      author: post?.author || "",
      status: post?.status || "draft",
      featuredImage: post?.featuredImage || "",
      featuredImageAlt: post?.featuredImageAlt || "",
      seoTitle: post?.seoTitle || "",
      seoDescription: post?.seoDescription || "",
      seoKeywords: post?.seoKeywords || "",
      primaryCtaLabel: post?.primaryCtaLabel || "",
      primaryCtaHref: post?.primaryCtaHref || "",
      primaryPromoCode: post?.primaryPromoCode || "",
      publishedAt: formatDateTimeLocalInput(post?.publishedAt),
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertBlogPost) => await apiRequest("POST", "/api/admin/blog", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      toast({ title: "Success", description: "Blog post created successfully" });
      onSuccess();
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertBlogPost>) => await apiRequest("PATCH", `/api/admin/blog/${post?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      toast({ title: "Success", description: "Blog post updated successfully" });
      onSuccess();
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const replaceSelection = (insertText: string, selectFrom?: number, selectTo?: number) => {
    const textarea = editorRef.current;
    const currentValue = form.getValues("contentMarkdown") || "";
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? currentValue.length;
    const nextValue = `${currentValue.slice(0, selectionStart)}${insertText}${currentValue.slice(selectionEnd)}`;

    form.setValue("contentMarkdown", nextValue, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    requestAnimationFrame(() => {
      if (!textarea) {
        return;
      }
      textarea.focus();
      const start = selectionStart + (selectFrom ?? insertText.length);
      const end = selectionStart + (selectTo ?? insertText.length);
      textarea.setSelectionRange(start, end);
    });
  };

  const wrapSelection = (prefix: string, suffix: string, fallback = "text") => {
    const textarea = editorRef.current;
    const currentValue = form.getValues("contentMarkdown") || "";
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? currentValue.length;
    const selected = currentValue.slice(selectionStart, selectionEnd) || fallback;
    const next = `${prefix}${selected}${suffix}`;
    replaceSelection(next, prefix.length, prefix.length + selected.length);
  };

  const insertTemplate = (template: string) => replaceSelection(template);

  const transformSelectedLines = (
    transformLine: (line: string, index: number) => string,
    fallback: string,
  ) => {
    const textarea = editorRef.current;
    const currentValue = form.getValues("contentMarkdown") || "";
    const rawStart = textarea?.selectionStart ?? currentValue.length;
    const rawEnd = textarea?.selectionEnd ?? currentValue.length;

    if (rawStart === rawEnd) {
      replaceSelection(fallback);
      return;
    }

    const blockStart = currentValue.lastIndexOf("\n", Math.max(0, rawStart - 1)) + 1;
    const nextNewline = currentValue.indexOf("\n", rawEnd);
    const blockEnd = nextNewline === -1 ? currentValue.length : nextNewline;
    const selectedBlock = currentValue.slice(blockStart, blockEnd);
    const transformedBlock = selectedBlock
      .split("\n")
      .map((line, index) => transformLine(line, index))
      .join("\n");

    const nextValue = `${currentValue.slice(0, blockStart)}${transformedBlock}${currentValue.slice(blockEnd)}`;
    form.setValue("contentMarkdown", nextValue, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    requestAnimationFrame(() => {
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(blockStart, blockStart + transformedBlock.length);
    });
  };

  const applyLinePrefix = (prefix: string, fallback: string) => {
    transformSelectedLines(
      (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return line;
        }
        const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
        const withoutExisting = trimmed.replace(/^([-*+]\s+|>\s+|\d+\.\s+|##\s+|###\s+)/, "");
        return `${leadingWhitespace}${prefix}${withoutExisting}`;
      },
      fallback,
    );
  };

  const applyNumberedList = () => {
    transformSelectedLines(
      (line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return line;
        }
        const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
        const withoutExisting = trimmed.replace(/^([-*+]\s+|>\s+|\d+\.\s+|##\s+|###\s+)/, "");
        return `${leadingWhitespace}${index + 1}. ${withoutExisting}`;
      },
      "\n1. First step\n2. Second step\n3. Third step\n",
    );
  };

  const handleInlineImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImageUploadPending(true);
    try {
      const dataUrl = await optimizeImage(file);
      const response = await apiRequest("POST", "/api/admin/media", {
        dataUrl,
        mimeType: "image/jpeg",
      });
      const payload = await response.json();
      setInlineImageUrl(payload.mediaUrl);
      if (!inlineImageAlt.trim()) {
        setInlineImageAlt(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
      }
      toast({
        title: "Image ready",
        description: "Place your cursor in the right section and insert the image block.",
      });
    } catch (error) {
      const description = error instanceof Error && error.message.startsWith("401:")
        ? "Your admin session has expired. Please sign in again, then retry the upload."
        : error instanceof Error
          ? error.message
          : "Could not upload image";
      toast({
        title: "Upload failed",
        description,
        variant: "destructive",
      });
    } finally {
      setImageUploadPending(false);
      event.target.value = "";
    }
  };

  const handleInlineLibrarySelect = (urls: string[]) => {
    const url = urls[0];
    if (url) {
      setInlineImageUrl(url);
    }
  };

  const handleInsertInlineImage = () => {
    if (!inlineImageUrl) {
      toast({
        title: "Add an image first",
        description: "Upload a section image before inserting it into the article.",
        variant: "destructive",
      });
      return;
    }

    const alt = inlineImageAlt.trim() || form.getValues("title") || "Article image";
    const caption = inlineImageCaption.trim();
    const imageBlock = caption
      ? `![${alt}](${inlineImageUrl} "${caption}")\n`
      : `![${alt}](${inlineImageUrl})\n`;

    replaceSelection(`${imageBlock}\n`);
    setInlineImageCaption("");
  };

  const handleInsertLink = () => {
    const href = linkUrl.trim();
    if (!href) {
      toast({
        title: "Add a link first",
        description: "Enter an internal path like /accommodations or a full external URL.",
        variant: "destructive",
      });
      return;
    }

    const label = linkLabel.trim() || "Read more";
    replaceSelection(`[${label}](${href})`);
    setLinkLabel("");
    setLinkUrl("");
  };

  const onSubmit = (data: BlogFormData) => {
    const slug = data.slug || generateSlug(data.title);
    const submitData: InsertBlogPost = {
      ...data,
      slug,
      featuredImage: data.featuredImage || null,
      featuredImageAlt: data.featuredImageAlt?.trim() || data.title,
      seoTitle: data.seoTitle?.trim() || data.title,
      seoDescription: data.seoDescription?.trim() || data.excerpt,
      seoKeywords: data.seoKeywords?.trim() || null,
      primaryCtaLabel: data.primaryCtaLabel?.trim() || null,
      primaryCtaHref: data.primaryCtaHref?.trim() || null,
      primaryPromoCode: data.primaryPromoCode?.trim().toUpperCase() || null,
      publishedAt: data.publishedAt || null,
    };

    if (isEditing) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleTitleChange = (value: string) => {
    form.setValue("title", value);
    if (!isEditing && !form.getValues("slug")) {
      form.setValue("slug", generateSlug(value));
    }
    if (!form.getValues("seoTitle")) {
      form.setValue("seoTitle", value, { shouldDirty: true });
    }
    if (!form.getValues("featuredImageAlt")) {
      form.setValue("featuredImageAlt", value, { shouldDirty: true });
    }
  };

  const contentValue = form.watch("contentMarkdown") || "";
  const sectionCount = (contentValue.match(/^##\s+/gm) || []).length;
  const hasFaq = /^##\s+frequently asked questions|^##\s+faq/im.test(contentValue);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Article Basics</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(e) => handleTitleChange(e.target.value)}
                          placeholder="Enter blog post title"
                          data-testid="input-blog-title"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="auto-generated-from-title" data-testid="input-blog-slug" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="author"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Author</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Author name" data-testid="input-blog-author" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-blog-status">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="publishedAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Publish Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="datetime-local" data-testid="input-blog-published-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="excerpt"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Excerpt</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Brief summary of the blog post"
                          rows={4}
                          data-testid="input-blog-excerpt"
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Keep this tight and descriptive. Search engines and preview cards rely on it heavily.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Featured Visual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="featuredImage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Featured Image</FormLabel>
                      <FormControl>
                        <AdminMediaField
                          value={field.value}
                          onChange={({ mediaUrl }) => form.setValue("featuredImage", mediaUrl, { shouldDirty: true, shouldValidate: true })}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="featuredImageAlt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Featured Image Alt Text</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Describe the image for search engines and accessibility"
                          data-testid="input-blog-featured-image-alt"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Writing Studio</CardTitle>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{sectionCount} sections</Badge>
                    <Badge variant={hasFaq ? "default" : "secondary"}>{hasFaq ? "FAQ ready" : "Add FAQ"}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => wrapSelection("**", "**", "bold text")}>
                    <Bold className="mr-2 h-4 w-4" />
                    Bold
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => wrapSelection("*", "*", "italic text")}>
                    <Italic className="mr-2 h-4 w-4" />
                    Italic
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => applyLinePrefix("## ", "\n## Section heading\nWrite the main insight here.\n")}>
                    <Heading2 className="mr-2 h-4 w-4" />
                    Section
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => applyLinePrefix("### ", "\n### Supporting point\nAdd a shorter supporting note.\n")}>
                    <Heading3 className="mr-2 h-4 w-4" />
                    Subsection
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => applyLinePrefix("- ", "\n- First point\n- Second point\n- Third point\n")}>
                    <List className="mr-2 h-4 w-4" />
                    Bullet List
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={applyNumberedList}>
                    <ListOrdered className="mr-2 h-4 w-4" />
                    Numbered List
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={() => applyLinePrefix("> ", "\n> Concierge note: add a memorable pull quote or planning tip here.\n")}>
                    <Quote className="mr-2 h-4 w-4" />
                    Pull Quote
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="justify-start sm:w-auto" onClick={handleInsertLink}>
                    <Link2 className="mr-2 h-4 w-4" />
                    Insert Link
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="justify-start"
                    onClick={() =>
                      insertTemplate(
                        "## Overview\nSet up the promise of the article in 2-3 concise paragraphs.\n\n## Highlights\n- Signature detail\n- Practical takeaway\n- Why it matters\n",
                      )
                    }
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Insert SEO-friendly opener
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="justify-start"
                    onClick={() =>
                      insertTemplate(
                        "\n## Frequently asked questions\n### What should guests know before booking?\nAnswer clearly in one short paragraph.\n\n### When is the best time to go?\nAnswer clearly in one short paragraph.\n",
                      )
                    }
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Insert FAQ block
                  </Button>
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <div className="mb-4 grid gap-3 border-b border-border/60 pb-4 md:grid-cols-[1fr_1fr_auto]">
                    <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Link text" />
                    <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/accommodations or https://example.com" />
                    <Button type="button" variant="outline" onClick={handleInsertLink}>
                      <Link2 className="mr-2 h-4 w-4" />
                      Add Link
                    </Button>
                  </div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <ImagePlus className="h-4 w-4" />
                    Section image block
                  </div>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Upload an image, place the cursor inside the right section, then insert it with alt text and a caption.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <label className="flex-1 cursor-pointer">
                          <div className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground">
                            <ImagePlus className="h-4 w-4" />
                            Upload new
                          </div>
                          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleInlineImageUpload} className="sr-only" />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={() => setInlineLibraryOpen(true)}
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          From library
                        </Button>
                      </div>
                      <Input value={inlineImageAlt} onChange={(e) => setInlineImageAlt(e.target.value)} placeholder="Image alt text" />
                      <Input value={inlineImageCaption} onChange={(e) => setInlineImageCaption(e.target.value)} placeholder="Caption" />
                    </div>
                    <div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-background/90 p-4">
                      {inlineImageUrl ? (
                        <img src={inlineImageUrl} alt={inlineImageAlt || "Inline article"} className="aspect-[4/3] w-full rounded-lg object-cover" />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                          Upload or choose an article image
                        </div>
                      )}
                      <Button type="button" variant="outline" onClick={handleInsertInlineImage} disabled={imageUploadPending}>
                        {imageUploadPending ? "Uploading..." : "Insert At Cursor"}
                      </Button>
                    </div>
                  </div>
                  <MediaLibraryPicker
                    open={inlineLibraryOpen}
                    onOpenChange={setInlineLibraryOpen}
                    onSelect={handleInlineLibrarySelect}
                    mode="single"
                    title="Choose Article Image"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="contentMarkdown"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content (Markdown)</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          ref={(node) => {
                            field.ref(node);
                            editorRef.current = node;
                          }}
                          placeholder="Write your blog post content in markdown..."
                          rows={16}
                          data-testid="input-blog-content"
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Use `##` for sections, `###` for subsections, `**bold**`, `*italics*`, and image captions with markdown titles.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>SEO Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="seoTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SEO Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Search result title" data-testid="input-blog-seo-title" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Defaults to the article title if left blank.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="seoDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SEO Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={4} placeholder="Search description" data-testid="input-blog-seo-description" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Defaults to the excerpt if left blank.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="seoKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SEO Keywords</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="mombasa travel, concierge stay, kenya experiences" data-testid="input-blog-seo-keywords" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Use a short comma-separated list of the main search themes.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Conversion CTA</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="primaryCtaLabel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CTA Label</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Book the coastal stay bundle" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Shown on the public article as the primary action block.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="primaryCtaHref"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CTA Destination</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="/book/stay-id or /services/drive" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Use an internal path so the app can carry attribution through to booking.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="primaryPromoCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Promo Code</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="COASTAL-BUNDLE" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Optional. This preloads the promo when the CTA leads into a booking flow.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="border-stone-200/80 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Editor Guide</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground">Suggested structure</p>
                  <p>Title, excerpt, overview, 2-4 clear sections, one FAQ block, then a short closing note.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Images with captions</p>
                  <p>Upload the image, place the cursor where it belongs, then insert it so the caption sits directly below the visual.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Formatting cues</p>
                  <p>Use bold for emphasis, italics for light notes, and section headings that match likely search intent.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-end gap-4">
          <Button className="w-full sm:w-auto" type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-blog">
            {createMutation.isPending || updateMutation.isPending ? "Saving..." : isEditing ? "Update Post" : "Create Post"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function AdminBlog() {
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<BlogStatusFilter>("all");
  const { toast } = useToast();
  const { isLoading: authLoading, isAdmin } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      setLocation("/auth?next=/admin/blog");
    }
  }, [authLoading, isAdmin, setLocation]);

  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ["/api/admin/blog"],
    enabled: isAdmin,
  });

  const normalizedQuery = searchTerm.trim().toLowerCase();

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      const matchesStatus = statusFilter === "all" || post.status === statusFilter;
      if (!matchesStatus) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchText = [
        post.title,
        post.slug,
        post.author,
        post.excerpt,
        post.seoTitle ?? "",
        post.seoDescription ?? "",
      ].join(" ").toLowerCase();

      return searchText.includes(normalizedQuery);
    });
  }, [normalizedQuery, posts, statusFilter]);

  const summary = useMemo(() => {
    const published = posts.filter((post) => post.status === "published").length;
    const draft = posts.filter((post) => post.status === "draft").length;
    const seoReady = posts.filter((post) => isSeoReady(post)).length;

    return {
      total: posts.length,
      published,
      draft,
      seoReady,
    };
  }, [posts]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/blog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      toast({ title: "Success", description: "Blog post deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this blog post?")) {
      deleteMutation.mutate(id);
    }
  };

  if (authLoading) {
    return (
      <AdminLayout>
        <div className="p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="animate-pulse">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Blog Management</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Create richer, sectioned articles with better SEO control and guided media placement, now in a layout that is much easier to manage on phones.
                </p>
              </div>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full sm:w-auto" data-testid="button-create-blog">
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Post
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto sm:w-full">
                  <DialogHeader>
                    <DialogTitle>Create New Blog Post</DialogTitle>
                  </DialogHeader>
                  <BlogPostForm onSuccess={() => setIsCreateDialogOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BlogSummaryCard
            title="Posts"
            value={summary.total}
            description="All posts currently available in blog management."
          />
          <BlogSummaryCard
            title="Published"
            value={summary.published}
            description="Posts currently visible on the live blog."
          />
          <BlogSummaryCard
            title="Drafts"
            value={summary.draft}
            description="Posts still being edited or waiting for review."
          />
          <BlogSummaryCard
            title="SEO Ready"
            value={summary.seoReady}
            description="Posts with core SEO fields already in place."
          />
        </section>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="space-y-4">
            <div className="space-y-1">
              <CardTitle>Search and Filter</CardTitle>
              <CardDescription>Focus the post list by title, author, slug, excerpt, or publishing status.</CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search posts"
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as BlogStatusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((index) => (
              <Card key={index} className="border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="space-y-3">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-16 animate-pulse rounded bg-muted" />
                  <div className="h-10 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <Card className="border-stone-200/80 bg-white shadow-sm">
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">No blog posts yet. Create your first post to get started.</p>
            </CardContent>
          </Card>
        ) : filteredPosts.length === 0 ? (
          <Card className="border-stone-200/80 bg-white shadow-sm">
            <CardContent className="space-y-4 p-12 text-center">
              <p className="text-muted-foreground">No posts match the current search and status filters.</p>
              <Button variant="outline" onClick={() => { setSearchTerm(""); setStatusFilter("all"); }}>
                Clear filters
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredPosts.map((post) => {
              const postIsSeoReady = isSeoReady(post);
              const sectionTotal = (post.contentMarkdown.match(/^##\s+/gm) || []).length || 0;

              return (
                <Card key={post.id} className="border-stone-200/80 bg-white shadow-sm" data-testid={`card-blog-${post.id}`}>
                  <CardContent className="space-y-4 p-5 sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant={post.status === "published" ? "default" : "secondary"} data-testid={`badge-status-${post.id}`}>
                            {post.status}
                          </Badge>
                          <Badge variant={postIsSeoReady ? "default" : "secondary"}>
                            {postIsSeoReady ? "SEO ready" : "Needs SEO polish"}
                          </Badge>
                          <Badge variant="outline">{sectionTotal} sections</Badge>
                        </div>
                        <CardTitle className="line-clamp-2 text-xl tracking-tight">{post.title}</CardTitle>
                      </div>
                    </div>

                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>Author</span>
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground" data-testid={`text-author-${post.id}`}>
                          {post.author}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>Published</span>
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground" data-testid={`text-published-${post.id}`}>
                          {post.publishedAt ? format(new Date(post.publishedAt), "MMM d, yyyy") : "Not scheduled"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 sm:col-span-2 xl:col-span-1">
                        <div className="text-sm text-muted-foreground">Updated</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {format(new Date(post.updatedAt), "MMM d, yyyy")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground break-all">/{post.slug}</div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                      <Dialog open={editingPost?.id === post.id} onOpenChange={(open) => !open && setEditingPost(null)}>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setEditingPost(post)}
                            data-testid={`button-edit-${post.id}`}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit post
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto sm:w-full">
                          <DialogHeader>
                            <DialogTitle>Edit Blog Post</DialogTitle>
                          </DialogHeader>
                          <BlogPostForm post={post} onSuccess={() => setEditingPost(null)} />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        className="w-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto"
                        onClick={() => handleDelete(post.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${post.id}`}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete post
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
